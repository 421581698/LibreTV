import type { ChangeImpact } from "./change-impact";
import type {
  DiscoveryAgent,
  PlanningContext,
  RepositorySnapshot,
  TestGeneratorAgent,
  TestPlanAgent,
  GeneratedTestArtifact,
} from "./agent-contracts";
import { validateTestPlan } from "./test-planner";
import type { TestPlan } from "./types";

export interface PlanningPipelineResult {
  plan: TestPlan;
  discoveries: PlanningContext["discoveries"];
  generatedTests: GeneratedTestArtifact[];
}

export async function runPlanningPipeline(input: {
  snapshot: RepositorySnapshot;
  impact: ChangeImpact;
  objective: string;
  discoveryAgent: DiscoveryAgent;
  plannerAgent: TestPlanAgent;
  generatorAgent: TestGeneratorAgent;
  allowedDirectories: string[];
  framework: "vitest" | "playwright" | "api";
}): Promise<PlanningPipelineResult> {
  const discoveries = await input.discoveryAgent.discover(input.snapshot, input.impact);
  const context: PlanningContext = {
    snapshot: input.snapshot,
    impact: input.impact,
    discoveries,
    objective: input.objective,
  };
  const plan = await input.plannerAgent.createPlan(context);
  const errors = validateTestPlan(plan);
  if (errors.length) throw new Error(`Planner returned an invalid plan: ${errors.join(" ")}`);
  if (plan.commitSha !== input.snapshot.commitSha || plan.branch !== input.snapshot.branch) {
    throw new Error("Planner returned a plan for a different repository revision.");
  }

  const generatedTests = await input.generatorAgent.generate({
    plan,
    allowedDirectories: input.allowedDirectories,
    framework: input.framework,
  });
  if (plan.cases.some((testCase) => testCase.required) && generatedTests.length === 0) {
    throw new Error("Generator returned no test artifacts for a plan with required cases.");
  }
  const seenPaths = new Set<string>();
  for (const artifact of generatedTests) {
    if (artifact.framework !== input.framework) throw new Error(`Generator returned an unexpected framework for ${artifact.path}.`);
    const normalized = artifact.path.replace(/\\/g, "/");
    const allowed = input.allowedDirectories.some((directory) => {
      const prefix = directory.replace(/\\/g, "/").replace(/\/$/, "") + "/";
      return normalized.startsWith(prefix);
    });
    if (!allowed || normalized.split("/").some((part) => part === ".." || part === ".")) {
      throw new Error(`Generated test path is outside the allowed directories: ${artifact.path}`);
    }
    if (seenPaths.has(normalized)) throw new Error(`Generator returned a duplicate path: ${normalized}`);
    if (!artifact.content.trim() || !artifact.rationale.trim()) {
      throw new Error(`Generated test artifact requires content and rationale: ${normalized}`);
    }
    seenPaths.add(normalized);
  }

  return { plan, discoveries, generatedTests };
}
