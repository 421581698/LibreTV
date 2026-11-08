import type { AgentExecutionContext, FridayAgent } from "./dag-orchestrator";

export type MovieCandidate = {
  id: string;
  title: string;
  year?: string;
  sourceId?: string;
  vodId?: string;
  evidence?: string[];
};

export type SourceProbe = {
  sourceId: string;
  checkedAt: string;
  reachable: boolean;
  latencyMs?: number;
  probeDurationMs?: number;
  originTtfbMs?: number;
  decodedResolutionHeight?: number;
  resolutionSource?: "decoded_playback" | "playlist_or_segment" | "unknown";
  probeResultCached?: boolean;
  statusCode?: number;
  advertisedQualities?: string[];
  candidateId?: string;
  title?: string;
  resolutionHeight?: number;
  resolutionProbed?: boolean;
  resolutionError?: string;
};

export type QualityAssessment = {
  sourceId: string;
  candidateId?: string;
  title?: string;
  status: "resolution_detected" | "resolution_unknown" | "unavailable" | "unknown";
  assessmentCompleted: boolean;
  resolutionHeight: number | null;
  latencyMs: number | null;
  probeDurationMs: number | null;
  originTtfbMs: number | null;
  decodedResolutionHeight: number | null;
  resolutionSource: "decoded_playback" | "playlist_or_segment" | "unknown";
  probeResultCached: boolean | null;
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
      const saved = context.checkpointState as { candidates?: unknown } | undefined;
      const candidates = Array.isArray(saved?.candidates)
        ? candidatesFrom(saved.candidates)
        : await adapters.search({ query }, context.signal);
      if (!Array.isArray(candidates)) throw new Error("Search adapter returned an invalid result");
      await context.checkpoint({ candidateCount: candidates.length, candidates });
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
      const saved = context.checkpointState as { probes?: unknown } | undefined;
      const probes = Array.isArray(saved?.probes)
        ? saved.probes as SourceProbe[]
        : await adapters.probe({ candidates }, context.signal);
      if (!Array.isArray(probes)) throw new Error("Source probe adapter returned an invalid result");
      await context.checkpoint({ probeCount: probes.length, probes });
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
      const saved = context.checkpointState as { assessments?: unknown } | undefined;
      const assessments: QualityAssessment[] = Array.isArray(saved?.assessments)
        ? saved.assessments as QualityAssessment[]
        : probes.map((probe) => {
        const validLatency = typeof probe.latencyMs === "number" &&
          Number.isFinite(probe.latencyMs) && probe.latencyMs >= 0;
        const validReachability = typeof probe.reachable === "boolean";
        const validHeight = typeof probe.resolutionHeight === "number" &&
          Number.isFinite(probe.resolutionHeight) && probe.resolutionHeight > 0;
        const validDecodedHeight = typeof probe.decodedResolutionHeight === "number" &&
          Number.isFinite(probe.decodedResolutionHeight) && probe.decodedResolutionHeight > 0;
        const validOriginTtfb = typeof probe.originTtfbMs === "number" &&
          Number.isFinite(probe.originTtfbMs) && probe.originTtfbMs >= 0;
        const probeCompleted = probe.resolutionProbed === true;
        const evidence: string[] = [];
        if (probeCompleted) evidence.push("quality_probe.completed");
        if (validHeight) evidence.push("hls_or_segment.resolution_height");
        if (validDecodedHeight) evidence.push("player.videoHeight");
        if (validReachability) evidence.push("source.reachable");
        if (validLatency) evidence.push("source.latency");
        if (typeof probe.probeDurationMs === "number" && Number.isFinite(probe.probeDurationMs) && probe.probeDurationMs >= 0) evidence.push("quality_probe.duration_ms");
        if (validOriginTtfb) evidence.push("origin.media_ttfb_ms");
        return {
          sourceId: probe.sourceId,
          candidateId: probe.candidateId,
          title: probe.title,
          status: validHeight ? "resolution_detected" : probe.resolutionError ? "unavailable" : probeCompleted ? "resolution_unknown" : "unknown",
          assessmentCompleted: probeCompleted || Boolean(probe.resolutionError),
          resolutionHeight: validDecodedHeight
            ? probe.decodedResolutionHeight!
            : validHeight ? probe.resolutionHeight! : null,
          latencyMs: validLatency ? probe.latencyMs! : null,
          probeDurationMs: typeof probe.probeDurationMs === "number" && Number.isFinite(probe.probeDurationMs) && probe.probeDurationMs >= 0 ? probe.probeDurationMs : null,
          originTtfbMs: validOriginTtfb ? probe.originTtfbMs! : null,
          decodedResolutionHeight: validDecodedHeight ? probe.decodedResolutionHeight! : null,
          resolutionSource: validDecodedHeight ? "decoded_playback" : validHeight ? "playlist_or_segment" : "unknown",
          probeResultCached: typeof probe.probeResultCached === "boolean" ? probe.probeResultCached : null,
          reachable: validReachability ? probe.reachable : null,
          advertisedQualities: Array.isArray(probe.advertisedQualities)
            ? probe.advertisedQualities.filter((quality): quality is string => typeof quality === "string")
            : [],
          evidence,
        };
      });
      await context.checkpoint({ assessmentCount: assessments.length, assessments });
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
      // Every candidate must be matched by its stable candidate ID. A source-level
      // match is insufficient because one source can return multiple different titles.
      const assessmentCounts = new Map<string, number>();
      for (const assessment of assessments) {
        if (typeof assessment.candidateId === "string" && assessment.candidateId) {
          assessmentCounts.set(assessment.candidateId, (assessmentCounts.get(assessment.candidateId) ?? 0) + 1);
        }
      }
      const candidateIds = new Set(candidates.map((candidate) => candidate.id));
      const unmatchedCandidates = candidates.filter((candidate) => !assessmentCounts.has(candidate.id));
      const duplicateCandidateAssessments = [...assessmentCounts.entries()]
        .filter(([, count]) => count > 1).map(([id]) => id);
      const orphanAssessments = assessments.filter((item) =>
        !item.candidateId || !candidateIds.has(item.candidateId),
      );
      const invalidMeasurements = assessments.filter((item) =>
        item.status === "resolution_detected" &&
        (!(typeof item.resolutionHeight === "number" && Number.isFinite(item.resolutionHeight) && item.resolutionHeight > 0) ||
          !item.evidence.includes("hls_or_segment.resolution_height") && !item.evidence.includes("player.videoHeight")),
      );
      const duplicateCandidateIds = candidates.filter((candidate, index) =>
        candidates.findIndex((item) => item.id === candidate.id) !== index,
      );
      const findings = [
        ...(!Array.isArray(searchOutput.candidates) ? ["missing-search-candidates"] : []),
        ...candidates.filter((candidate) => !candidate.id || !candidate.title).map(() => "invalid-candidate"),
        ...(duplicateCandidateIds.length ? ["duplicate-search-candidate-id"] : []),
        ...(unmatchedCandidates.length ? ["candidate-without-quality-assessment"] : []),
        ...(duplicateCandidateAssessments.length ? ["duplicate-candidate-assessment"] : []),
        ...(orphanAssessments.length ? ["assessment-for-unknown-candidate"] : []),
        ...assessments.filter((item) => !item.assessmentCompleted).map(() => "quality-assessment-incomplete"),
        ...(invalidMeasurements.length ? ["measurement-without-resolution-evidence"] : []),
      ];
      const review = {
        accepted: findings.length === 0,
        reviewStatus: findings.length === 0 ? "complete" : "incomplete",
        measurementCompleted: candidates.length > 0 && assessments.length === candidates.length && assessments.every((item) => item.assessmentCompleted) && unmatchedCandidates.length === 0 && duplicateCandidateAssessments.length === 0 && orphanAssessments.length === 0,
        resolutionMeasured: assessments.some((item) => item.status === "resolution_detected"),
        findings,
        candidateCount: candidates.length,
        assessmentCount: assessments.length,
        duplicateCandidateAssessments: duplicateCandidateAssessments,
        orphanAssessmentCount: orphanAssessments.length,
        unmatchedCandidates: unmatchedCandidates.map((item) => item.id),
        measurementScope: "decoded_playback_or_playlist_segment_resolution",
        note: "player.videoHeight is decoded playback evidence; HLS playlist or segment resolution is source-side evidence. They are kept distinct, and advertised labels alone are not proof.",
      };
      await context.checkpoint(review);
      return review;
    },
  };

  const playbackAgent: FridayAgent = {
    id: "playback-agent",
    async execute(context) {
      const input = objectInput(context.task.input);
      const searchTaskId = typeof input.searchTaskId === "string" ? input.searchTaskId : "search";
      const qualityTaskId = typeof input.qualityTaskId === "string" ? input.qualityTaskId : "quality";
      const reviewTaskId = typeof input.reviewTaskId === "string" ? input.reviewTaskId : "review";
      const searchOutput = objectInput(dependencyValue(context, searchTaskId));
      const qualityOutput = objectInput(dependencyValue(context, qualityTaskId));
      const reviewOutput = objectInput(dependencyValue(context, reviewTaskId));
      const candidates = candidatesFrom(searchOutput.candidates);
      const assessments = Array.isArray(qualityOutput.assessments)
        ? qualityOutput.assessments as QualityAssessment[]
        : [];

      if (reviewOutput.accepted !== true) {
        const withheld = {
          ready: false,
          recommendations: [],
          reason: "Quality review did not accept the candidate evidence; automatic source selection is withheld.",
        };
        await context.checkpoint(withheld);
        return withheld;
      }

      const assessmentByCandidate = new Map<string, QualityAssessment>();
      const duplicateAssessmentIds = new Set<string>();
      for (const assessment of assessments) {
        if (typeof assessment.candidateId !== "string" || !assessment.candidateId ||
          duplicateAssessmentIds.has(assessment.candidateId)) continue;
        if (assessmentByCandidate.has(assessment.candidateId)) {
          assessmentByCandidate.delete(assessment.candidateId);
          duplicateAssessmentIds.add(assessment.candidateId);
          continue;
        }
        assessmentByCandidate.set(assessment.candidateId, assessment);
      }

      const byTitle = new Map<string, Array<{
        candidate: MovieCandidate;
        assessment: QualityAssessment;
      }>>();
      for (const candidate of candidates) {
        const title = candidate.title.trim();
        const normalizedTitle = title.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
        const normalizedYear = typeof candidate.year === "string"
          ? (candidate.year.match(/\d{4}/)?.[0] ?? "")
          : "";
        // Different releases can share a title. Never compare source quality
        // across distinct known years; missing years remain in their own group.
        const titleKey = normalizedTitle ? `${normalizedTitle}::${normalizedYear}` : "";
        const assessment = assessmentByCandidate.get(candidate.id);
        if (!titleKey || !candidate.sourceId || !assessment ||
          assessment.assessmentCompleted !== true || assessment.reachable !== true) continue;
        const group = byTitle.get(titleKey) ?? [];
        group.push({ candidate, assessment });
        byTitle.set(titleKey, group);
      }

      const recommendations = [...byTitle.values()].map((group) => {
        group.sort((left, right) => {
          const leftHeight = left.assessment.status === "resolution_detected"
            ? left.assessment.resolutionHeight ?? 0 : 0;
          const rightHeight = right.assessment.status === "resolution_detected"
            ? right.assessment.resolutionHeight ?? 0 : 0;
          return rightHeight - leftHeight ||
            String(left.candidate.sourceId).localeCompare(String(right.candidate.sourceId)) ||
            left.candidate.id.localeCompare(right.candidate.id);
        });
        const selected = group[0];
        const measured = selected.assessment.status === "resolution_detected" &&
          typeof selected.assessment.resolutionHeight === "number" &&
          selected.assessment.resolutionHeight > 0;
        return {
          title: selected.candidate.title,
          candidateId: selected.candidate.id,
          sourceId: selected.candidate.sourceId!,
          resolutionHeight: measured ? selected.assessment.resolutionHeight : null,
          selectionBasis: measured ? "measured-resolution" as const : "reachable-only" as const,
          alternativeCount: Math.max(0, group.length - 1),
          requiresUserConfirmation: true as const,
        };
      });

      const playback = {
        ready: true,
        recommendations,
        reason: recommendations.length
          ? "Selected the reachable candidate with the highest measured decoded playback or source-side resolution; unknown resolution is never presented as measured."
          : "No candidate has both a completed quality assessment and a reachable source.",
      };
      await context.checkpoint(playback);
      return playback;
    },
  };

  return [searchAgent, sourceAgent, qualityAgent, reviewAgent, playbackAgent];
}
