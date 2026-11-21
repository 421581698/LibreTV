import { describe, expect, it } from "vitest";
import { createTestRun, isTerminalRunStatus, transitionTestRun } from "../quality-engine/core/task-runtime";
import { InMemoryEventStore, withSequence } from "../quality-engine/core/event-store";
import { analyzeChangeImpact } from "../quality-engine/core/change-impact";
import { classifyFailure } from "../quality-engine/core/failure-classifier";
import { evaluateQualityGate } from "../quality-engine/core/quality-gates";

describe("Quality Engine task runtime", () => {
  it("creates a pending run with immutable source identity", () => {
    const run = createTestRun({ id: "run-1", planId: "plan-1", commitSha: "abc123", branch: "feature/test" });
    expect(run).toMatchObject({ id: "run-1", status: "pending", commitSha: "abc123", branch: "feature/test" });
  });

  it("requires complete run identity", () => {
    expect(() => createTestRun({ id: "", planId: "p", commitSha: "sha", branch: "branch" })).toThrow();
  });

  it("records start and completion timestamps", () => {
    const pending = createTestRun({ id: "run-2", planId: "plan-1", commitSha: "abc", branch: "feature/x", createdAt: "2026-01-01T00:00:00Z" });
    const started = transitionTestRun(pending, "running", { eventId: "evt-1", occurredAt: "2026-01-01T00:01:00Z" });
    const completed = transitionTestRun(started.run, "passed", { eventId: "evt-2", occurredAt: "2026-01-01T00:02:00Z", summary: "all checks passed" });
    expect(started.run.startedAt).toBe("2026-01-01T00:01:00Z");
    expect(completed.run.finishedAt).toBe("2026-01-01T00:02:00Z");
    expect(completed.run.summary).toBe("all checks passed");
  });

  it("rejects invalid transitions and terminal-state rewrites", () => {
    const pending = createTestRun({ id: "run-3", planId: "p", commitSha: "sha", branch: "branch" });
    expect(() => transitionTestRun(pending, "passed", { eventId: "evt" })).toThrow(/Invalid test-run transition/);
    const failed = transitionTestRun(transitionTestRun(pending, "running", { eventId: "a" }).run, "failed", { eventId: "b" }).run;
    expect(isTerminalRunStatus(failed.status)).toBe(true);
    expect(() => transitionTestRun(failed, "running", { eventId: "c" })).toThrow();
  });

  it("records blocked separately from failed", () => {
    const pending = createTestRun({ id: "run-4", planId: "p", commitSha: "sha", branch: "branch" });
    const blocked = transitionTestRun(pending, "blocked", { eventId: "blocked", summary: "device unavailable" });
    expect(blocked.run.status).toBe("blocked");
    expect(blocked.event.type).toBe("run.blocked");
  });

  it("requires event identity", () => {
    const pending = createTestRun({ id: "run-5", planId: "p", commitSha: "sha", branch: "branch" });
    expect(() => transitionTestRun(pending, "running", { eventId: "" })).toThrow();
  });
});

describe("Quality Engine event store", () => {
  it("appends ordered events and returns defensive copies", async () => {
    const store = new InMemoryEventStore();
    const base = { id: "e1", runId: "r1", sequence: 1, type: "run.created" as const, occurredAt: "2026-01-01T00:00:00Z", payload: { branch: "feature/a" } };
    await store.append(base);
    const listed = await store.listByRun("r1");
    listed[0].payload.branch = "mutated";
    expect((await store.listByRun("r1"))[0].payload.branch).toBe("feature/a");
  });

  it("rejects duplicate IDs and out-of-order events", async () => {
    const store = new InMemoryEventStore();
    const event = { id: "e1", runId: "r1", sequence: 1, type: "run.created" as const, occurredAt: "2026-01-01T00:00:00Z", payload: {} };
    await store.append(event);
    await expect(store.append(event)).rejects.toThrow(/Duplicate/);
    await expect(store.append({ ...event, id: "e2", sequence: 3 })).rejects.toThrow(/sequence/);
  });

  it("assigns only positive integer sequence numbers", () => {
    const event = { id: "e1", runId: "r1", sequence: 0, type: "run.created" as const, occurredAt: "now", payload: {} };
    expect(() => withSequence(event, 0)).toThrow();
    expect(withSequence(event, 1).sequence).toBe(1);
  });
});

describe("Quality Engine change impact", () => {
  it("detects independent player and media coverage requirements", () => {
    const impact = analyzeChangeImpact(["src/components/PlayerShell.tsx", "src/lib/media/hls.ts"]);
    expect(impact.areas).toContain("player");
    expect(impact.areas).toContain("media");
    expect(impact.requiresMedia).toBe(true);
    expect(impact.requiresPhysicalIPhone).toBe(true);
    expect(impact.requiresPhysicalIPad).toBe(true);
  });

  it("does not demand physical devices for a documentation-only change", () => {
    const impact = analyzeChangeImpact(["docs/testing/README.md"]);
    expect(impact.areas).toContain("unknown");
    expect(impact.requiresPhysicalIPhone).toBe(false);
    expect(impact.requiresPhysicalIPad).toBe(false);
  });

  it("recognizes quality-engine changes without classifying them as app UI", () => {
    const impact = analyzeChangeImpact(["quality-engine/core/task-runtime.ts"]);
    expect(impact.areas).toContain("quality-engine");
    expect(impact.requiresBrowser).toBe(false);
  });

  it("returns unknown for an empty path list", () => {
    expect(analyzeChangeImpact([]).areas).toEqual(["unknown"]);
  });
});

describe("Quality Engine failure classifier", () => {
  it("classifies external providers separately", () => {
    expect(classifyFailure({ message: "Douban API returned 503", source: "provider" }).category).toBe("third-party");
  });

  it("classifies broken test harness separately", () => {
    expect(classifyFailure({ message: "Playwright browser executable not installed", source: "test-runner" }).category).toBe("test");
  });

  it("classifies Preview network failures as environment", () => {
    expect(classifyFailure({ message: "connection refused while checking preview", source: "network" }).category).toBe("environment");
  });

  it("classifies observed application errors as product defects", () => {
    expect(classifyFailure({ message: "uncaught TypeError", pageError: true }).category).toBe("product");
  });

  it("does not guess when evidence is insufficient", () => {
    expect(classifyFailure({ message: "something failed" })).toMatchObject({ category: "unknown", confidence: "low" });
  });
});

 
describe("Quality Engine quality gate", () => {
  it("allows eligibility only when every required check passed", () => {
    const result = evaluateQualityGate([
      { id: "unit", required: true, outcome: "passed", evidenceIds: ["junit-1"] },
      { id: "preview", required: true, outcome: "passed", evidenceIds: ["trace-1"] },
      { id: "optional-a11y", required: false, outcome: "not-run" },
    ]);
    expect(result).toMatchObject({ eligible: true, status: "ready", passed: ["unit", "preview"], optionalNotRun: ["optional-a11y"] });
  });

  it("blocks eligibility for failed, blocked, and not-run required checks", () => {
    const result = evaluateQualityGate([
      { id: "unit", required: true, outcome: "passed" },
      { id: "browser", required: true, outcome: "failed" },
      { id: "preview", required: true, outcome: "blocked" },
      { id: "physical-iphone", required: true, outcome: "not-run" },
    ]);
    expect(result).toMatchObject({
      eligible: false,
      status: "blocked",
      failed: ["browser"],
      blocked: ["preview"],
      notRun: ["physical-iphone"],
    });
  });

  it("does not allow an empty required-check list to imply successful verification", () => {
    expect(evaluateQualityGate([])).toMatchObject({ eligible: false, status: "blocked", notRun: ["__no_required_checks__"] });
  });
});
