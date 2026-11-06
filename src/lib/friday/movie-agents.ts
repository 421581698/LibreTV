import type { AgentExecutionContext, FridayAgent } from "./dag-orchestrator";

export type MovieCandidate = {
  id: string;
  title: string;
  sourceId?: string;
  evidence?: string[];
};

export type SourceProbe = {
  sourceId: string;
  checkedAt: string;
  reachable: boolean;
  latencyMs?: number;
  statusCode?: number;
  advertisedQualities?: string[];
};

export type QualityAssessment = {
  sourceId: string;
  status: "measured" | "unavailable" | "unknown";
  latencyMs: number | null;
  reachable: boolean | null;
  advertisedQualities: string[];
  evidence: string[];
};

export type MovieAgentAdapters = {
  search(input: { query: string }, signal?: AbortSignal): Promise<MovieCandidate[]>;
  probe(input: { candidates: MovieCandidate[] }, signal?: AbortSignal): Promise<SourceProbe[]>;
};

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent input must be an object");
  }
  return value as Record<string, unknown>;
}

function candidatesFrom(value: unknown): MovieCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MovieCandidate =>
    Boolean(item && typeof item === "object" &&
      typeof (item as MovieCandidate).id === "string" &&
      typeof (item as MovieCandidate).title === "string"),
  );
}

function dependencyValue(context: AgentExecutionContext, key: string): unknown {
  return context.dependencyOutputs[key];
}

export function createMovieAgentRegistry(adapters: MovieAgentAdapters): FridayAgent[] {
  const searchAgent: FridayAgent = {
    id: "search-agent",
    async execute(context) {
      const input = objectInput(context.task.input);
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query) throw new Error("Search Agent requires a non-empty query");
      await context.progress({ stage: "searching", query });
      const candidates = await adapters.search({ query }, context.signal);
      if (!Array.isArray(candidates)) throw new Error("Search adapter returned an invalid result");
      await context.checkpoint({ candidateCount: candidates.length });
      return { query, candidates };
    },
  };

  const sourceAgent: FridayAgent = {
    id: "source-agent",
    async execute(context) {
      const input = objectInput(context.task.input);
      const dependencyKey = typeof input.searchTaskId === "string" ? input.searchTaskId : "search";
      const searchOutput = objectInput(dependencyValue(context, dependencyKey));
      const candidates = candidatesFrom(searchOutput.candidates);
      await context.progress({ stage: "probing", candidateCount: candidates.length });
      const probes = await adapters.probe({ candidates }, context.signal);
      if (!Array.isArray(probes)) throw new Error("Source probe adapter returned an invalid result");
      return { probes };
    },
  };

  const qualityAgent: FridayAgent = {
    id: "quality-agent",
    async execute(context) {
      const input = objectInput(context.task.input);
      const sourceTaskId = typeof input.sourceTaskId === "string" ? input.sourceTaskId : "source";
      const sourceOutput = objectInput(dependencyValue(context, sourceTaskId));
      const probes = Array.isArray(sourceOutput.probes) ? sourceOutput.probes as SourceProbe[] : [];
      const assessments: QualityAssessment[] = probes.map((probe) => {
        const validLatency = typeof probe.latencyMs === "number" &&
          Number.isFinite(probe.latencyMs) && probe.latencyMs >= 0;
        const validReachability = typeof probe.reachable === "boolean";
        const evidence: string[] = [];
        if (validReachability) evidence.push("probe.reachable");
        if (validLatency) evidence.push("probe.latencyMs");
        if (typeof probe.statusCode === "number") evidence.push("probe.statusCode");
        return {
          sourceId: probe.sourceId,
          status: validLatency || validReachability ? (probe.reachable ? "measured" : "unavailable") : "unknown",
          latencyMs: validLatency ? probe.latencyMs! : null,
          reachable: validReachability ? probe.reachable : null,
          advertisedQualities: Array.isArray(probe.advertisedQualities)
            ? probe.advertisedQualities.filter((quality): quality is string => typeof quality === "string")
            : [],
          evidence,
        };
      });
      return { assessments };
    },
  };

  const reviewAgent: FridayAgent = {
    id: "review-agent",
    async execute(context) {
      const input = objectInput(context.task.input);
      const searchTaskId = typeof input.searchTaskId === "string" ? input.searchTaskId : "search";
      const qualityTaskId = typeof input.qualityTaskId === "string" ? input.qualityTaskId : "quality";
      const searchOutput = objectInput(dependencyValue(context, searchTaskId));
      const qualityOutput = objectInput(dependencyValue(context, qualityTaskId));
      const candidates = candidatesFrom(searchOutput.candidates);
      const assessments = Array.isArray(qualityOutput.assessments)
        ? qualityOutput.assessments as QualityAssessment[]
        : [];
      const assessmentIds = new Set(assessments.map((item) => item.sourceId));
      const findings = [
        ...(!Array.isArray(searchOutput.candidates) ? ["missing-search-candidates"] : []),
        ...candidates.filter((candidate) => !candidate.id || !candidate.title).map(() => "invalid-candidate"),
        ...assessments.filter((item) => item.status === "measured" && item.evidence.length === 0)
          .map(() => "measurement-without-evidence"),
      ];
      return {
        accepted: findings.length === 0,
        findings,
        candidateCount: candidates.length,
        assessmentCount: assessments.length,
        unmatchedCandidates: candidates.filter((candidate) => candidate.sourceId && !assessmentIds.has(candidate.sourceId)).map((item) => item.id),
        note: "Only measured probe fields are treated as evidence; advertised quality labels are not proof of playback quality.",
      };
    },
  };

  return [searchAgent, sourceAgent, qualityAgent, reviewAgent];
}
