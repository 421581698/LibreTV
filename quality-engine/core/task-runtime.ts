import type { TestEvent, TestRun, TestRunStatus } from "./types";

export interface CreateRunInput {
  id: string;
  planId: string;
  commitSha: string;
  branch: string;
  previewUrl?: string;
  createdAt?: string;
}

export interface TransitionResult {
  run: TestRun;
  event: TestEvent;
}

const TERMINAL = new Set<TestRunStatus>(["passed", "failed", "blocked", "not-run", "cancelled"]);

const ALLOWED: Record<TestRunStatus, TestRunStatus[]> = {
  pending: ["running", "blocked", "cancelled"],
  running: ["passed", "failed", "blocked", "cancelled"],
  passed: [],
  failed: [],
  blocked: [],
  "not-run": [],
  cancelled: [],
};

export function createTestRun(input: CreateRunInput): TestRun {
  if (!input.id.trim() || !input.planId.trim() || !input.commitSha.trim() || !input.branch.trim()) {
    throw new Error("A run requires id, planId, commitSha, and branch.");
  }
  return {
    id: input.id,
    planId: input.planId,
    commitSha: input.commitSha,
    branch: input.branch,
    ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
    status: "pending",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function transitionTestRun(
  current: TestRun,
  next: TestRunStatus,
  options: { eventId: string; occurredAt?: string; summary?: string },
): TransitionResult {
  if (!options.eventId.trim()) throw new Error("An eventId is required.");
  if (!ALLOWED[current.status].includes(next)) {
    throw new Error(`Invalid test-run transition: ${current.status} -> ${next}`);
  }

  const occurredAt = options.occurredAt ?? new Date().toISOString();
  const run: TestRun = { ...current, status: next };
  if (next === "running") run.startedAt = occurredAt;
  if (TERMINAL.has(next)) {
    run.finishedAt = occurredAt;
    if (options.summary) run.summary = options.summary;
  }

  const type: TestEvent["type"] =
    next === "running" ? "run.started" :
    next === "blocked" ? "run.blocked" :
    next === "cancelled" ? "run.cancelled" :
    "run.completed";

  return {
    run,
    event: {
      id: options.eventId,
      runId: current.id,
      sequence: 0,
      type,
      occurredAt,
      payload: { from: current.status, to: next, ...(options.summary ? { summary: options.summary } : {}) },
    },
  };
}

export function isTerminalRunStatus(status: TestRunStatus): boolean {
  return TERMINAL.has(status);
}
