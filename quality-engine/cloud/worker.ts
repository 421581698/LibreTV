import { D1EventStore, type D1Database } from "./d1-event-store";
import type { TestEvent } from "../core/types";

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}
interface D1Binding extends D1Database {
  prepare(query: string): D1Statement;
}
interface R2ObjectBody {
  body: ReadableStream;
  size: number;
}
interface R2Bucket {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

interface Env {
  QUALITY_DB: D1Binding;
  QUALITY_ARTIFACTS: R2Bucket;
  QUALITY_API_TOKEN_SHA256: string;
}

const MAX_JSON_BYTES = 64 * 1024;
const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;
const EVENT_TYPES = new Set([
  "run.created", "run.started", "run.completed", "run.blocked", "run.cancelled",
  "case.started", "case.completed", "defect.detected", "fix.recorded", "evidence.recorded",
]);
const EVIDENCE_KINDS = new Set(["screenshot", "video", "trace", "console", "network", "junit", "log"]);
const EVIDENCE_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "video/webm", "application/zip",
  "application/json", "application/xml", "text/plain",
]);
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function validId(value: string): boolean {
  return RUN_ID.test(value);
}

async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > limit) throw new Error(`Request body exceeds the ${limit} byte limit.`);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error(`Request body exceeds the ${limit} byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readJson(request: Request): Promise<unknown> {
  const bytes = await readLimitedBody(request, MAX_JSON_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isValidRun(value: unknown): value is {
  id: string; planId: string; project: string; commitSha: string; branch: string;
  previewUrl?: string; createdAt?: string;
} {
  if (!isRecord(value)) return false;
  if (![value.id, value.planId, value.project, value.commitSha, value.branch].every(
    (item) => typeof item === "string" && item.trim().length > 0,
  )) return false;
  if (!validId(value.id as string) || (value.project as string).length > 120 ||
      (value.branch as string).length > 200 || (value.planId as string).length > 128) return false;
  if (!/^[a-f0-9]{40}$/i.test(value.commitSha as string)) return false;
  if (value.previewUrl !== undefined) {
    if (typeof value.previewUrl !== "string") return false;
    try {
      const url = new URL(value.previewUrl);
      if (url.protocol !== "https:" || url.username || url.password) return false;
    } catch { return false; }
  }
  return true;
}

function isValidEvent(value: unknown, runId: string): value is TestEvent {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && validId(value.id) &&
    value.runId === runId &&
    Number.isInteger(value.sequence) && Number(value.sequence) > 0 &&
    typeof value.type === "string" && EVENT_TYPES.has(value.type) &&
    typeof value.occurredAt === "string" && Number.isFinite(Date.parse(value.occurredAt)) &&
    isRecord(value.payload);
}

async function authorized(request: Request, expectedHash: string): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(match[1]));
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  let difference = actual.length ^ expectedHash.length;
  for (let index = 0; index < Math.max(actual.length, expectedHash.length); index += 1) {
    difference |= (actual.charCodeAt(index) || 0) ^ (expectedHash.toLowerCase().charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ service: "libretv-quality-engine", status: "ok", storage: ["d1", "r2"] });
  }
  if (!(await authorized(request, env.QUALITY_API_TOKEN_SHA256))) return json({ error: "unauthorized" }, 401);

  if (request.method === "POST" && url.pathname === "/v1/runs") {
    let input: unknown;
    try { input = await readJson(request); } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid_json" }, 400);
    }
    if (!isValidRun(input)) return json({ error: "invalid_run_payload" }, 400);
    const now = new Date().toISOString();
    try {
      await env.QUALITY_DB.prepare(
        "INSERT INTO quality_runs (run_id, plan_id, project, branch, commit_sha, preview_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
      ).bind(input.id, input.planId, input.project, input.branch, input.commitSha, input.previewUrl ?? null, input.createdAt ?? now, now).run();
    } catch {
      return json({ error: "run_already_exists_or_storage_conflict" }, 409);
    }
    return json({ id: input.id, status: "pending", createdAt: now }, 201);
  }

  const runMatch = /^\/v1\/runs\/([^/]+)$/.exec(url.pathname);
  if (runMatch && request.method === "GET") {
    const runId = decodeURIComponent(runMatch[1]);
    if (!validId(runId)) return json({ error: "invalid_run_id" }, 400);
    const run = await env.QUALITY_DB.prepare(
      "SELECT run_id, plan_id, project, branch, commit_sha, preview_url, status, created_at, updated_at FROM quality_runs WHERE run_id = ?",
    ).bind(runId).first();
    if (!run) return json({ error: "run_not_found" }, 404);
    return json(run);
  }

  const eventsMatch = /^\/v1\/runs\/([^/]+)\/events$/.exec(url.pathname);
  if (eventsMatch) {
    const runId = decodeURIComponent(eventsMatch[1]);
    if (!validId(runId)) return json({ error: "invalid_run_id" }, 400);
    if (request.method === "GET") {
      const events = await new D1EventStore(env.QUALITY_DB).listByRun(runId);
      return json({ runId, events });
    }
    if (request.method === "POST") {
      let input: unknown;
      try { input = await readJson(request); } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid_json" }, 400);
      }
      if (!isValidEvent(input, runId)) return json({ error: "invalid_event_payload" }, 400);
      try {
        await new D1EventStore(env.QUALITY_DB).append(input);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "event_append_failed" }, 409);
      }
      return json({ accepted: true, runId, sequence: input.sequence }, 201);
    }
  }

  const evidenceMatch = /^\/v1\/runs\/([^/]+)\/evidence(?:\/([^/]+))?$/.exec(url.pathname);
  if (evidenceMatch) {
    const runId = decodeURIComponent(evidenceMatch[1]);
    if (!validId(runId)) return json({ error: "invalid_run_id" }, 400);
    const evidenceId = evidenceMatch[2] ? decodeURIComponent(evidenceMatch[2]) : null;
    if (request.method === "POST" && evidenceId) {
      if (!validId(evidenceId)) return json({ error: "invalid_evidence_id" }, 400);
      const kind = request.headers.get("x-evidence-kind") ?? "";
      const label = request.headers.get("x-evidence-label") ?? evidenceId;
      const contentType = (request.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
      if (!EVIDENCE_KINDS.has(kind) || !EVIDENCE_TYPES.has(contentType) || label.length > 160) {
        return json({ error: "invalid_evidence_metadata" }, 400);
      }
      let bytes: Uint8Array;
      try { bytes = await readLimitedBody(request, MAX_EVIDENCE_BYTES); } catch {
        return json({ error: "evidence_too_large" }, 413);
      }
      if (bytes.byteLength === 0) return json({ error: "empty_evidence" }, 400);
      const exists = await env.QUALITY_DB.prepare(
        "SELECT run_id FROM quality_runs WHERE run_id = ?",
      ).bind(runId).first();
      if (!exists) return json({ error: "run_not_found" }, 404);

      // Unique object keys prevent a racing duplicate upload from overwriting
      // the winner's R2 object before the D1 uniqueness constraint rejects it.
      const objectKey = `runs/${runId}/${evidenceId}/${crypto.randomUUID()}`;
      await env.QUALITY_ARTIFACTS.put(objectKey, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
        httpMetadata: { contentType },
      });
      try {
        await env.QUALITY_DB.prepare(
          "INSERT INTO quality_evidence (evidence_id, run_id, kind, object_key, content_type, byte_size, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(evidenceId, runId, kind, objectKey, contentType, bytes.byteLength, label, new Date().toISOString()).run();
      } catch {
        await env.QUALITY_ARTIFACTS.delete(objectKey);
        return json({ error: "evidence_already_exists_or_storage_conflict" }, 409);
      }
      return json({ evidenceId, runId, kind, byteSize: bytes.byteLength }, 201);
    }
    if (request.method === "GET" && evidenceId) {
      if (!validId(evidenceId)) return json({ error: "invalid_evidence_id" }, 400);
      const metadata = await env.QUALITY_DB.prepare(
        "SELECT object_key, content_type FROM quality_evidence WHERE run_id = ? AND evidence_id = ?",
      ).bind(runId, evidenceId).first<{ object_key: string; content_type: string }>();
      if (!metadata) return json({ error: "evidence_not_found" }, 404);
      const object = await env.QUALITY_ARTIFACTS.get(metadata.object_key);
      if (!object) return json({ error: "evidence_object_missing" }, 404);
      return new Response(object.body, {
        headers: {
          "content-type": metadata.content_type,
          "content-length": String(object.size),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (request.method === "GET" && !evidenceId) {
      const result = await env.QUALITY_DB.prepare(
        "SELECT evidence_id, run_id, kind, content_type, byte_size, label, created_at FROM quality_evidence WHERE run_id = ? ORDER BY created_at DESC",
      ).bind(runId).all();
      return json({ runId, evidence: result.results });
    }
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch {
      // Do not leak SQL, storage, or secret details to callers.
      return json({ error: "internal_error" }, 500);
    }
  },
};
