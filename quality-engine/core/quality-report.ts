import type { DefectRecord, EvidenceRecord, TestPlan, TestRun } from "./types";
import { evaluateQualityGate, type QualityCheck } from "./quality-gates";

export interface DeviceAcceptance {
  device: "iphone" | "ipad";
  outcome: "passed" | "failed" | "blocked" | "not-run";
  deviceModel?: string;
  osVersion?: string;
  browserVersion?: string;
  evidenceIds: string[];
  notes?: string;
}

export interface QualityReportInput {
  plan: TestPlan;
  run: TestRun;
  checks: QualityCheck[];
  evidence: EvidenceRecord[];
  defects: DefectRecord[];
  devices?: DeviceAcceptance[];
  generatedAt?: string;
}

export interface QualityReport {
  schemaVersion: 1;
  generatedAt: string;
  project: string;
  branch: string;
  commitSha: string;
  previewUrl?: string;
  planId: string;
  runId: string;
  runStatus: TestRun["status"];
  gate: ReturnType<typeof evaluateQualityGate>;
  evidence: EvidenceRecord[];
  defects: DefectRecord[];
  devices: DeviceAcceptance[];
  releaseEligible: boolean;
}

export function buildQualityReport(input: QualityReportInput): QualityReport {
  if (input.plan.id !== input.run.planId) throw new Error("Report plan and run do not match.");
  if (input.plan.commitSha !== input.run.commitSha) throw new Error("Report plan and run commit SHA do not match.");
  const evidenceIds = new Set(input.evidence.map((item) => item.id));
  const missingEvidenceReferences = input.checks.flatMap((check) =>
    (check.evidenceIds ?? []).filter((id) => !evidenceIds.has(id)).map((id) => `${check.id} -> ${id}`),
  );
  const gate = evaluateQualityGate(input.checks);
  if (missingEvidenceReferences.length) {
    gate.eligible = false;
    gate.status = "blocked";
    gate.missingEvidence.push(...missingEvidenceReferences);
  }
  const requiredDevices = input.plan.cases.filter((testCase) => testCase.required && testCase.tags.includes("physical-device"));
  const deviceOutcomes = new Map((input.devices ?? []).map((device) => [device.device, device]));
  const devices = (input.devices ?? []).map((device) => ({ ...device, evidenceIds: [...device.evidenceIds] }));
  const requiredDeviceBlocked = requiredDevices.some((testCase) => {
    const device = testCase.tags.includes("iphone") ? deviceOutcomes.get("iphone") : deviceOutcomes.get("ipad");
    return !device || device.outcome !== "passed" || device.evidenceIds.length === 0 ||
      device.evidenceIds.some((id) => !evidenceIds.has(id));
  });
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    project: input.plan.project,
    branch: input.run.branch,
    commitSha: input.run.commitSha,
    ...(input.run.previewUrl ? { previewUrl: input.run.previewUrl } : {}),
    planId: input.plan.id,
    runId: input.run.id,
    runStatus: input.run.status,
    gate,
    evidence: input.evidence.map((item) => ({ ...item })),
    defects: input.defects.map((item) => ({ ...item, evidenceIds: [...item.evidenceIds], regressionCaseIds: [...item.regressionCaseIds] })),
    devices,
    releaseEligible: gate.eligible && input.run.status === "passed" && !requiredDeviceBlocked,
  };
}
