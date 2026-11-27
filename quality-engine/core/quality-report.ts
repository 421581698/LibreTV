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
  blockingDefects: string[];
}

export function buildQualityReport(input: QualityReportInput): QualityReport {
  if (input.plan.id !== input.run.planId) throw new Error("Report plan and run do not match.");
  if (input.plan.commitSha !== input.run.commitSha) throw new Error("Report plan and run commit SHA do not match.");
  if (input.plan.branch !== input.run.branch) throw new Error("Report plan and run branch do not match.");
  const evidenceIds = new Set(input.evidence.map((item) => item.id));
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const missingEvidenceReferences = input.checks.flatMap((check) =>
    (check.evidenceIds ?? []).filter((id) => {
      const evidence = evidenceById.get(id);
      return !evidence || evidence.runId !== input.run.id;
    }).map((id) => `${check.id} -> ${id}`),
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
    return !device || device.outcome !== "passed" || !device.deviceModel?.trim() ||
      !device.osVersion?.trim() || !device.browserVersion?.trim() || device.evidenceIds.length === 0 ||
      device.evidenceIds.some((id) => {
        const evidence = evidenceById.get(id);
        return !evidence || evidence.runId !== input.run.id;
      });
  });
  const blockingDefects = input.defects.filter((defect) => defect.severity === "blocker" || defect.severity === "critical").map((defect) => defect.id);
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
    blockingDefects,
    releaseEligible: gate.eligible && input.run.status === "passed" && Boolean(input.run.startedAt && input.run.finishedAt) && !requiredDeviceBlocked && blockingDefects.length === 0,
  };
}
