import type { ChangeImpact, ImpactArea } from "./change-impact";
import type { TestCase, TestPlan } from "./types";

export interface CreatePlanInput {
  id: string;
  project: string;
  commitSha: string;
  branch: string;
  objective: string;
  createdAt?: string;
  impact: ChangeImpact;
}

const CASES: Record<ImpactArea, Omit<TestCase, "id">[]> = {
  homepage: [{ title: "Homepage loads and primary content is visible", area: "homepage", priority: "p1", required: true, tags: ["browser", "smoke"] }],
  search: [
    { title: "Search validates empty input and submits a query", area: "search", priority: "p1", required: true, tags: ["browser", "user-flow"] },
    { title: "Search handles empty, loading, and error results", area: "search", priority: "p1", required: true, tags: ["browser", "negative"] },
  ],
  player: [
    { title: "Player controls preserve play, pause, and seek state", area: "player", priority: "p0", required: true, tags: ["browser", "player"] },
    { title: "Player source failure exposes recovery behavior", area: "player", priority: "p0", required: true, tags: ["browser", "negative", "regression"] },
  ],
  media: [
    { title: "Media pipeline loads supported source and renders first frame", area: "media", priority: "p0", required: true, tags: ["media", "playback"] },
    { title: "Media pipeline handles buffering, timeout, and source changes", area: "media", priority: "p0", required: true, tags: ["media", "recovery"] },
  ],
  "subtitle-audio": [
    { title: "Subtitle selection and synchronization remain correct", area: "subtitle-audio", priority: "p1", required: true, tags: ["media", "subtitle"] },
    { title: "Audio track selection and output state remain correct", area: "subtitle-audio", priority: "p1", required: true, tags: ["media", "audio"] },
  ],
  friday: [{ title: "Friday interaction and voice lifecycle states remain valid", area: "friday", priority: "p1", required: true, tags: ["browser", "voice", "state-machine"] }],
  navigation: [{ title: "Navigation, back behavior, and responsive controls work", area: "navigation", priority: "p1", required: true, tags: ["browser", "navigation"] }],
  api: [{ title: "Changed API validates input and expected error responses", area: "api", priority: "p1", required: true, tags: ["api", "contract"] }],
  "quality-engine": [{ title: "Quality Engine core contracts and quality gates pass", area: "quality-engine", priority: "p0", required: true, tags: ["unit", "quality-engine", "self-test"] }],
  unknown: [{ title: "Unclassified changes receive manual impact review", area: "unknown", priority: "p1", required: true, tags: ["manual-review", "risk"] }],
};

export function createBaselineTestPlan(input: CreatePlanInput): TestPlan {
  for (const [key, value] of Object.entries({
    id: input.id,
    project: input.project,
    commitSha: input.commitSha,
    branch: input.branch,
    objective: input.objective,
  })) {
    if (!value.trim()) throw new Error(`Test plan requires ${key}.`);
  }

  const cases: TestCase[] = [];
  const seen = new Set<string>();
  for (const area of input.impact.areas) {
    for (const definition of CASES[area]) {
      const id = `${area}-${cases.length + 1}`;
      if (seen.has(id)) continue;
      seen.add(id);
      cases.push({ id, ...definition });
    }
  }

  if (input.impact.requiresPhysicalIPhone) {
    cases.push({ id: "device-iphone-safari", title: "Physical iPhone Safari acceptance", area: "device-iphone", priority: "p0", required: true, tags: ["physical-device", "iphone", "safari"] });
  }
  if (input.impact.requiresPhysicalIPad) {
    cases.push({ id: "device-ipad-safari", title: "Physical iPad Safari acceptance", area: "device-ipad", priority: "p0", required: true, tags: ["physical-device", "ipad", "safari"] });
  }

  const riskLevel = input.impact.requiresMedia || input.impact.requiresPhysicalIPhone || input.impact.requiresPhysicalIPad
    ? "critical"
    : input.impact.areas.includes("unknown") ? "high"
    : input.impact.areas.includes("api") || input.impact.areas.includes("player") ? "high"
    : "medium";

  return {
    id: input.id,
    project: input.project,
    commitSha: input.commitSha,
    branch: input.branch,
    createdAt: input.createdAt ?? new Date().toISOString(),
    objective: input.objective,
    riskLevel,
    cases,
  };
}

export function validateTestPlan(plan: TestPlan): string[] {
  const errors: string[] = [];
  if (!plan.id.trim()) errors.push("Plan id is required.");
  if (!plan.project.trim()) errors.push("Project is required.");
  if (!plan.commitSha.trim()) errors.push("Commit SHA is required.");
  if (!plan.branch.trim()) errors.push("Branch is required.");
  if (!plan.objective.trim()) errors.push("Objective is required.");
  if (plan.cases.length === 0) errors.push("A test plan must contain at least one case.");
  const ids = new Set<string>();
  for (const testCase of plan.cases) {
    if (!testCase.id.trim()) errors.push("Every test case requires an id.");
    if (ids.has(testCase.id)) errors.push(`Duplicate test case id: ${testCase.id}`);
    ids.add(testCase.id);
    if (!testCase.title.trim()) errors.push(`Test case ${testCase.id} requires a title.`);
  }
  return errors;
}
