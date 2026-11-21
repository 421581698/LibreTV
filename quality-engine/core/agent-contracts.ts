import type { ChangeImpact } from "./change-impact";
import type { TestPlan } from "./types";

export interface RepositorySnapshot {
  project: string;
  commitSha: string;
  branch: string;
  changedPaths: string[];
  previewUrl?: string;
}

export interface DiscoveryFinding {
  id: string;
  area: string;
  title: string;
  route?: string;
  selectors?: string[];
  risk: "low" | "medium" | "high" | "critical";
  evidence?: string[];
}

export interface DiscoveryResult {
  findings: DiscoveryFinding[];
  completed: boolean;
  limitations: string[];
}

export interface PlanningContext {
  snapshot: RepositorySnapshot;
  impact: ChangeImpact;
  discoveries: DiscoveryResult;
  objective: string;
}

export interface TestPlanAgent {
  createPlan(context: PlanningContext): Promise<TestPlan>;
}

export interface DiscoveryAgent {
  discover(snapshot: RepositorySnapshot, impact: ChangeImpact): Promise<DiscoveryResult>;
}

export interface TestGenerationRequest {
  plan: TestPlan;
  allowedDirectories: string[];
  framework: "vitest" | "playwright" | "api";
}

export interface GeneratedTestArtifact {
  path: string;
  content: string;
  framework: TestGenerationRequest["framework"];
  rationale: string;
}

export interface TestGeneratorAgent {
  generate(request: TestGenerationRequest): Promise<GeneratedTestArtifact[]>;
}

/**
 * Model adapters implement these interfaces. Core orchestration must never
 * assume a vendor, API key, or model-specific response format.
 */
