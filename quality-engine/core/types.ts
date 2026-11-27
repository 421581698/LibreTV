export type QualityOutcome = "passed" | "failed" | "blocked" | "not-run";
export type TestRunStatus = "pending" | "running" | QualityOutcome | "cancelled";
export type TestEventType =
  | "run.created"
  | "run.started"
  | "run.completed"
  | "run.blocked"
  | "run.cancelled"
  | "case.started"
  | "case.completed"
  | "defect.detected"
  | "fix.recorded"
  | "evidence.recorded";

export interface TestPlan {
  id: string;
  project: string;
  commitSha: string;
  branch: string;
  createdAt: string;
  objective: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  cases: TestCase[];
}

export interface TestCase {
  id: string;
  title: string;
  area: string;
  priority: "p0" | "p1" | "p2" | "p3";
  required: boolean;
  tags: string[];
}

export interface TestRun {
  id: string;
  planId: string;
  commitSha: string;
  branch: string;
  previewUrl?: string;
  status: TestRunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
}

export interface TestEvent {
  id: string;
  runId: string;
  sequence: number;
  type: TestEventType;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface EvidenceRecord {
  id: string;
  runId: string;
  kind: "screenshot" | "video" | "trace" | "console" | "network" | "junit" | "log";
  uri: string;
  label: string;
  createdAt: string;
}

export interface DefectRecord {
  id: string;
  runId: string;
  category: "product" | "test" | "environment" | "third-party" | "unknown";
  severity: "blocker" | "critical" | "major" | "minor" | "info";
  title: string;
  details: string;
  evidenceIds: string[];
  regressionCaseIds: string[];
}
