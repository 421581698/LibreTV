import type { QualityOutcome } from "./types";

export interface QualityCheck {
  id: string;
  required: boolean;
  outcome: QualityOutcome;
  evidenceIds?: string[];
}

export interface QualityGateResult {
  eligible: boolean;
  status: "ready" | "blocked";
  passed: string[];
  failed: string[];
  blocked: string[];
  notRun: string[];
  optionalNotRun: string[];
  missingEvidence: string[];
}

export function evaluateQualityGate(checks: QualityCheck[]): QualityGateResult {
  const required = checks.filter((check) => check.required);
  const passed = required.filter((check) => check.outcome === "passed").map((check) => check.id);
  const failed = required.filter((check) => check.outcome === "failed").map((check) => check.id);
  const blocked = required.filter((check) => check.outcome === "blocked").map((check) => check.id);
  const notRun = required.filter((check) => check.outcome === "not-run").map((check) => check.id);
  const optionalNotRun = checks.filter((check) => !check.required && check.outcome === "not-run").map((check) => check.id);
  const missingEvidence = required.filter((check) => check.outcome === "passed" && (!check.evidenceIds || check.evidenceIds.length === 0)).map((check) => check.id);
  if (required.length === 0) notRun.push("__no_required_checks__");
  const eligible = required.length > 0 && failed.length === 0 && blocked.length === 0 && notRun.length === 0 && missingEvidence.length === 0;
  return {
    eligible,
    status: eligible ? "ready" : "blocked",
    passed,
    failed,
    blocked,
    notRun,
    optionalNotRun,
    missingEvidence,
  };
}
