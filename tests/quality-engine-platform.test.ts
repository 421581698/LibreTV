import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlEventStore } from "../quality-engine/core/jsonl-event-store";
import { createBaselineTestPlan, validateTestPlan } from "../quality-engine/core/test-planner";
import { buildQualityReport } from "../quality-engine/core/quality-report";
import type { TestEvent, TestRun } from "../quality-engine/core/types";
import type { ChangeImpact } from "../quality-engine/core/change-impact";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function event(id: string, runId = "run-a", sequence = 1): TestEvent {
  return { id, runId, sequence, type: "run.created", occurredAt: "2026-11-21T00:00:00.000Z", payload: { source: "test" } };
}

describe("Durable JSONL event store", () => {
  it("persists events across adapter instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "libretv-quality-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "events", "events.jsonl");
    await new JsonlEventStore(file).append(event("event-1"));
    const reopened = new JsonlEventStore(file);
    expect(await reopened.listByRun("run-a")).toEqual([event("event-1")]);
    expect((await readFile(file, "utf8")).trim()).toBe(JSON.stringify(event("event-1")));
  });

  it("serializes concurrent appends and rejects duplicate IDs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "libretv-quality-"));
    temporaryDirectories.push(directory);
    const store = new JsonlEventStore(join(directory, "events.jsonl"));
    await Promise.all([store.append(event("e1", "run-a", 1)), store.append(event("e2", "run-a", 2))]);
    await expect(store.append(event("e1", "run-a", 3))).rejects.toThrow(/Duplicate/);
    expect((await store.listByRun("run-a")).map((item) => item.sequence)).toEqual([1, 2]);
  });

  it("detects corrupt event files instead of silently discarding records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "libretv-quality-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "events.jsonl");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(file, "{broken json}\n", "utf8"));
    await expect(new JsonlEventStore(file).listByRun("run-a")).rejects.toThrow(/Corrupt event store/);
  });
});

describe("Baseline test planner", () => {
  const impact: ChangeImpact = {
    areas: ["player", "media"],
    requiresBrowser: true,
    requiresMedia: true,
    requiresPhysicalIPhone: true,
    requiresPhysicalIPad: true,
    matchedPaths: ["src/components/PlayerShell.tsx"],
  };

  it("creates separate physical iPhone and iPad cases for media changes", () => {
    const plan = createBaselineTestPlan({
      id: "plan-1", project: "LibreTV", commitSha: "abc123", branch: "feature/player",
      objective: "Verify player changes", impact,
    });
    expect(plan.riskLevel).toBe("critical");
    expect(plan.cases.map((item) => item.id)).toContain("device-iphone-safari");
    expect(plan.cases.map((item) => item.id)).toContain("device-ipad-safari");
    expect(validateTestPlan(plan)).toEqual([]);
  });

  it("rejects incomplete plans and duplicate case identifiers", () => {
    const plan = createBaselineTestPlan({
      id: "plan-2", project: "LibreTV", commitSha: "abc123", branch: "feature/docs",
      objective: "Verify docs", impact: { ...impact, areas: ["unknown"], requiresBrowser: false, requiresMedia: false, requiresPhysicalIPhone: false, requiresPhysicalIPad: false },
    });
    plan.cases.push({ ...plan.cases[0], title: "duplicate" });
    expect(validateTestPlan(plan)).toContain(`Duplicate test case id: ${plan.cases[0].id}`);
  });
});

describe("Quality report", () => {
  const plan = createBaselineTestPlan({
    id: "plan-report", project: "LibreTV", commitSha: "abc123", branch: "feature/test",
    objective: "Report gate", impact: {
      areas: ["quality-engine"], requiresBrowser: false, requiresMedia: false,
      requiresPhysicalIPhone: false, requiresPhysicalIPad: false, matchedPaths: [],
    },
  });
  const run: TestRun = {
    id: "run-report", planId: plan.id, commitSha: plan.commitSha, branch: plan.branch,
    status: "passed", createdAt: "2026-11-21T00:00:00.000Z",
  };

  it("allows a completed run only when required checks have referenced evidence", () => {
    const report = buildQualityReport({
      plan, run,
      checks: [{ id: "unit", required: true, outcome: "passed", evidenceIds: ["junit-1"] }],
      evidence: [{ id: "junit-1", runId: run.id, kind: "junit", uri: "artifacts/junit.xml", label: "Unit test report", createdAt: "2026-11-21T00:00:00.000Z" }],
      defects: [],
      generatedAt: "2026-11-21T00:01:00.000Z",
    });
    expect(report.releaseEligible).toBe(true);
    expect(report.gate.status).toBe("ready");
  });

  it("blocks reports with missing evidence references", () => {
    const report = buildQualityReport({
      plan, run,
      checks: [{ id: "unit", required: true, outcome: "passed", evidenceIds: ["missing"] }],
      evidence: [], defects: [],
    });
    expect(report.releaseEligible).toBe(false);
    expect(report.gate.missingEvidence).toContain("unit -> missing");
  });

  it("blocks a passed automation run when required physical device evidence is absent", () => {
    const mobilePlan = createBaselineTestPlan({
      id: "plan-mobile", project: "LibreTV", commitSha: "abc123", branch: "feature/player",
      objective: "Verify mobile player", impact: {
        areas: ["player"], requiresBrowser: true, requiresMedia: true,
        requiresPhysicalIPhone: true, requiresPhysicalIPad: true, matchedPaths: [],
      },
    });
    const mobileRun = { ...run, id: "run-mobile", planId: mobilePlan.id };
    const report = buildQualityReport({
      plan: mobilePlan, run: mobileRun,
      checks: [{ id: "unit", required: true, outcome: "passed", evidenceIds: ["junit-1"] }],
      evidence: [{ id: "junit-1", runId: mobileRun.id, kind: "junit", uri: "artifacts/junit.xml", label: "Unit tests", createdAt: "2026-11-21T00:00:00.000Z" }],
      defects: [],
    });
    expect(report.gate.eligible).toBe(true);
    expect(report.releaseEligible).toBe(false);
  });

  it("rejects reports that combine different plan and run revisions", () => {
    expect(() => buildQualityReport({
      plan, run: { ...run, commitSha: "different" }, checks: [], evidence: [], defects: [],
    })).toThrow(/commit SHA/);
  });
});
