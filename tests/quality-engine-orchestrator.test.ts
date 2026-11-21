import { describe, expect, it } from "vitest";
import { runPlanningPipeline } from "../quality-engine/core/orchestrator";
import type { ChangeImpact } from "../quality-engine/core/change-impact";
import type { DiscoveryAgent, TestGeneratorAgent, TestPlanAgent } from "../quality-engine/core/agent-contracts";
import type { TestPlan } from "../quality-engine/core/types";

const snapshot = { project: "LibreTV", commitSha: "sha-123", branch: "feature/quality", changedPaths: ["quality-engine/core"] };
const impact: ChangeImpact = {
  areas: ["quality-engine"], requiresBrowser: false, requiresMedia: false,
  requiresPhysicalIPhone: false, requiresPhysicalIPad: false, matchedPaths: ["quality-engine/core"],
};
const plan: TestPlan = {
  id: "plan-123", project: "LibreTV", commitSha: "sha-123", branch: "feature/quality",
  createdAt: "2026-11-21T00:00:00.000Z", objective: "Validate quality core", riskLevel: "medium",
  cases: [{ id: "case-1", title: "Core tests pass", area: "quality-engine", priority: "p0", required: true, tags: ["unit"] }],
};

function agents(generatedPath = "tests/generated/core.test.ts") {
  const discoveryAgent: DiscoveryAgent = {
    async discover() {
      return { findings: [{ id: "finding-1", area: "quality-engine", title: "Core contracts" }], completed: true, limitations: [] };
    },
  };
  const plannerAgent: TestPlanAgent = { async createPlan() { return plan; } };
  const generatorAgent: TestGeneratorAgent = {
    async generate() {
      return [{ path: generatedPath, content: "it('works', () => expect(true).toBe(true));", framework: "vitest", rationale: "Covers the required core contract." }];
    },
  };
  return { discoveryAgent, plannerAgent, generatorAgent };
}

describe("Quality Engine agent orchestrator", () => {
  it("runs discovery, planning, and generation against the same commit", async () => {
    const result = await runPlanningPipeline({
      snapshot, impact, objective: "Validate quality core", ...agents(),
      allowedDirectories: ["tests/generated"], framework: "vitest",
    });
    expect(result.plan.commitSha).toBe(snapshot.commitSha);
    expect(result.discoveries.findings).toHaveLength(1);
    expect(result.generatedTests).toHaveLength(1);
  });

  it("rejects generated paths outside the approved test directory", async () => {
    await expect(runPlanningPipeline({
      snapshot, impact, objective: "Validate quality core", ...agents("../src/unsafe.ts"),
      allowedDirectories: ["tests/generated"], framework: "vitest",
    })).rejects.toThrow(/outside the allowed directories/);
  });

  it("rejects a plan targeting a different commit", async () => {
    const invalidPlanner: TestPlanAgent = {
      async createPlan() { return { ...plan, commitSha: "other-sha" }; },
    };
    await expect(runPlanningPipeline({
      snapshot, impact, objective: "Validate quality core", ...agents(), plannerAgent: invalidPlanner,
      allowedDirectories: ["tests/generated"], framework: "vitest",
    })).rejects.toThrow(/different repository revision/);
  });
});
