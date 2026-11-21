export type FailureCategory = "product" | "test" | "environment" | "third-party" | "unknown";
export type FailureSeverity = "blocker" | "critical" | "major" | "minor" | "info";

export interface FailureSignals {
  message: string;
  source?: "application" | "test-runner" | "network" | "provider" | "assertion";
  httpStatus?: number;
  pageError?: boolean;
  assertionFailed?: boolean;
}

export interface FailureClassification {
  category: FailureCategory;
  severity: FailureSeverity;
  rationale: string;
  confidence: "high" | "medium" | "low";
}

export function classifyFailure(signals: FailureSignals): FailureClassification {
  const message = signals.message.toLowerCase();
  if (signals.source === "provider" || /douban|bangumi|upstream provider|third.party api/.test(message)) {
    return { category: "third-party", severity: "major", rationale: "Failure is explicitly associated with an external content provider.", confidence: "high" };
  }
  if (signals.source === "test-runner" || /browser executable|playwright.*not installed|test runner crashed|invalid selector/.test(message)) {
    return { category: "test", severity: "major", rationale: "Failure indicates the test harness or its configuration failed.", confidence: "high" };
  }
  if (signals.source === "network" || /connection refused|dns|timed out waiting for preview|preview unreachable/.test(message)) {
    return { category: "environment", severity: "major", rationale: "Failure indicates the target environment or network was unavailable.", confidence: "high" };
  }
  if (signals.pageError || signals.source === "application" || signals.assertionFailed || (signals.httpStatus !== undefined && signals.httpStatus >= 500)) {
    return { category: "product", severity: signals.httpStatus && signals.httpStatus >= 500 ? "critical" : "major", rationale: "An application error or user-visible assertion failure was observed.", confidence: "medium" };
  }
  return { category: "unknown", severity: "minor", rationale: "Available signals do not support a reliable root-cause classification.", confidence: "low" };
}
