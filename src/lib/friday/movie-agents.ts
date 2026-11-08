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
  upstreamRequestMs?: number;
  upstreamRequestCount?: number;
  originTtfbMs?: number;
  decodedResolutionHeight?: number;
  playbackSampleCount?: number;
  playbackMinHeight?: number;
  playbackMaxHeight?: number;
  lastPlaybackHeight?: number;
  lastPlaybackSampleAt?: number;
  probeResultCached?: boolean;
  statusCode?: number;
  advertisedQualities?: string[];
  candidateId?: string;
  title?: string;
  year?: string;
  resolutionHeight?: number;
  resolutionProbed?: boolean;
  resolutionError?: string;
};

export type QualityAssessment = {
  sourceId: string;
  candidateId?: string;
  title?: string;
  year?: string;
  status: "resolution_detected" | "resolution_unknown" | "unavailable" | "unknown";
  assessmentCompleted: boolean;
  resolutionHeight: number | null;
  decodedResolutionHeight: number | null;
  playbackSampleCount: number | null;
  playbackMinHeight: number | null;
  playbackMaxHeight: number | null;
  lastPlaybackHeight: number | null;
  sourceResolutionHeight: number | null;
  resolutionSource: "decoded_playback" | "playlist_or_segment" | "unknown";
  originTtfbMs: number | null;
  latencyMs: number | null;
  probeDurationMs: number | null;
  upstreamRequestMs: number | null;
  upstreamRequestCount: number | null;
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

export type PlaybackEvidenceInput = {
  candidateId: string;
  sourceId: string;
  vodId: string;
  decodedHeight: number;
  observedAt: string;
  sampleCount?: number;
  minHeight?: number;
  maxHeight?: number;
};

export function createPlaybackEvidenceAgent(): FridayAgent {
  return {
    id: "playback-evidence-agent",
    capabilities: ["playback.observe"],
    async execute(context) {
      context.requireCapability("playback.observe");
      const input = objectInput(context.task.input);
      const candidateId = typeof input.candidateId === "string" ? input.candidateId.trim() : "";
      const sourceId = typeof input.sourceId === "string" ? input.sourceId.trim() : "";
      const vodId = typeof input.vodId === "string" ? input.vodId.trim() : "";
      const height = input.decodedHeight;
      const observedAt = typeof input.observedAt === "string" ? input.observedAt : "";
      const observedTime = Date.parse(observedAt);
      if (!candidateId || !sourceId || !vodId || candidateId !== `${sourceId}:${vodId}`) {
        throw new Error("Playback evidence requires a matching candidate, source and VOD identity");
      }
      if (typeof height !== "number" || !Number.isInteger(height) || height < 1 || height > 16384) {
        throw new Error("Playback evidence contains an invalid decoded height");
      }
      if (!Number.isFinite(observedTime)) throw new Error("Playback evidence requires a valid observation timestamp");
      const sampleCount = input.sampleCount;
      if (sampleCount !== undefined && (typeof sampleCount !== "number" || !Number.isInteger(sampleCount) || sampleCount < 1)) {
        throw new Error("Playback evidence sample count must be a positive integer");
      }
      const minHeight = input.minHeight;
      const maxHeight = input.maxHeight;
      if (minHeight !== undefined && (typeof minHeight !== "number" || minHeight < 1 || minHeight > height)) {
        throw new Error("Playback evidence minimum height is invalid");
      }
      if (maxHeight !== undefined && (typeof maxHeight !== "number" || maxHeight < height || maxHeight > 16384)) {
        throw new Error("Playback evidence maximum height is invalid");
      }
      const evidence = {
        candidateId,
        sourceId,
        vodId,
        decodedHeight: height,
        sampleCount: sampleCount as number | undefined,
        minHeight: minHeight as number | undefined,
        maxHeight: maxHeight as number | undefined,
        observedAt: new Date(observedTime).toISOString(),
        evidenceSource: "player.videoHeight" as const,
      };
      await context.checkpoint(evidence);
      return { accepted: true, ...evidence };
    },
  };
}

export function createMovieAgentRegistry(adapters: MovieAgentAdapters): FridayAgent[] {
  const searchAgent: FridayAgent = {
    id: "search-agent",
    capabilities: ["movie.search"],
    async execute(context) {
      context.requireCapability("movie.search");
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
    capabilities: ["source.probe"],
    async execute(context) {
      context.requireCapability("source.probe");
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
    capabilities: ["quality.assess"],
    async execute(context) {
      context.requireCapability("quality.assess");
      const input = objectInput(context.task.input);
      const sourceTaskId = typeof input.sourceTaskId === "string" ? input.sourceTaskId : "source";
      const sourceOutput = objectInput(dependencyValue(context, sourceTaskId));
      const probes = Array.isArray(sourceOutput.probes) ? sourceOutput.probes as SourceProbe[] : [];
      const assessments: QualityAssessment[] = probes.map((probe) => {
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
        if (validOriginTtfb) evidence.push("origin.media_ttfb_ms");
        if (validReachability) evidence.push("source.reachable");
        if (validLatency) evidence.push("source.latency");
        if (typeof probe.probeDurationMs === "number" && Number.isFinite(probe.probeDurationMs) && probe.probeDurationMs >= 0) evidence.push("quality_probe.duration_ms");
        if (typeof probe.upstreamRequestMs === "number" && Number.isFinite(probe.upstreamRequestMs) && probe.upstreamRequestMs >= 0) evidence.push("quality_probe.upstream_request_ms");
        return {
          sourceId: probe.sourceId,
          candidateId: probe.candidateId,
          title: probe.title,
          year: probe.year,
          status: validDecodedHeight || validHeight ? "resolution_detected" : probe.resolutionError ? "unavailable" : probeCompleted ? "resolution_unknown" : "unknown",
          assessmentCompleted: probeCompleted || validDecodedHeight || Boolean(probe.resolutionError),
          resolutionHeight: validDecodedHeight ? probe.decodedResolutionHeight! : validHeight ? probe.resolutionHeight! : null,
          decodedResolutionHeight: validDecodedHeight ? probe.decodedResolutionHeight! : null,
          playbackSampleCount: Number.isInteger(probe.playbackSampleCount) && (probe.playbackSampleCount ?? 0) > 0 ? probe.playbackSampleCount! : validDecodedHeight ? 1 : null,
          playbackMinHeight: typeof probe.playbackMinHeight === "number" && probe.playbackMinHeight > 0 ? probe.playbackMinHeight : validDecodedHeight ? probe.decodedResolutionHeight! : null,
          playbackMaxHeight: typeof probe.playbackMaxHeight === "number" && probe.playbackMaxHeight > 0 ? probe.playbackMaxHeight : validDecodedHeight ? probe.decodedResolutionHeight! : null,
          lastPlaybackHeight: typeof probe.lastPlaybackHeight === "number" && probe.lastPlaybackHeight > 0 ? probe.lastPlaybackHeight : validDecodedHeight ? probe.decodedResolutionHeight! : null,
          sourceResolutionHeight: validHeight ? probe.resolutionHeight! : null,
          resolutionSource: validDecodedHeight ? "decoded_playback" : validHeight ? "playlist_or_segment" : "unknown",
          originTtfbMs: validOriginTtfb ? probe.originTtfbMs! : null,
          latencyMs: validLatency ? probe.latencyMs! : null,
          probeDurationMs: typeof probe.probeDurationMs === "number" && Number.isFinite(probe.probeDurationMs) && probe.probeDurationMs >= 0 ? probe.probeDurationMs : null,
          upstreamRequestMs: typeof probe.upstreamRequestMs === "number" && Number.isFinite(probe.upstreamRequestMs) && probe.upstreamRequestMs >= 0 ? probe.upstreamRequestMs : null,
          upstreamRequestCount: typeof probe.upstreamRequestCount === "number" && Number.isInteger(probe.upstreamRequestCount) && probe.upstreamRequestCount >= 0 ? probe.upstreamRequestCount : null,
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
    capabilities: ["quality.review"],
    async execute(context) {
      context.requireCapability("quality.review");
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
        note: "player.videoHeight is decoded playback evidence and takes precedence when available; HLS playlist or segment resolution remains separate source-side evidence. Advertised labels alone are not proof.",
      };
      await context.checkpoint(review);
      return review;
    },
  };

  const playbackAgent: FridayAgent = {
    id: "playback-agent",
    capabilities: ["playback.recommend"],
    async execute(context) {
      context.requireCapability("playback.recommend");
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
      const assessmentEvidenceRank = (assessment: QualityAssessment) =>
        assessment.resolutionSource === "decoded_playback" || assessment.evidence.includes("player.videoHeight") ? 2 :
          assessment.resolutionSource === "playlist_or_segment" || assessment.evidence.includes("hls_or_segment.resolution_height") ? 1 : 0;

      if (reviewOutput.accepted !== true) {
        return {
          ready: false,
          recommendations: [],
          reason: "Quality review did not accept the candidate evidence; automatic source selection is withheld.",
        };
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
          const rankOrder = assessmentEvidenceRank(right.assessment) - assessmentEvidenceRank(left.assessment);
          if (rankOrder !== 0) return rankOrder;
          const leftHeight = left.assessment.status === "resolution_detected" ? left.assessment.resolutionHeight ?? 0 : 0;
          const rightHeight = right.assessment.status === "resolution_detected" ? right.assessment.resolutionHeight ?? 0 : 0;
          const heightOrder = rightHeight - leftHeight;
          if (heightOrder !== 0) return heightOrder;
          const sampleOrder = (right.assessment.playbackSampleCount ?? 0) - (left.assessment.playbackSampleCount ?? 0);
          return sampleOrder ||
            String(left.candidate.sourceId).localeCompare(String(right.candidate.sourceId)) ||
            left.candidate.id.localeCompare(right.candidate.id);
        });
        const selected = group[0];
        const measured = selected.assessment.status === "resolution_detected" &&
          typeof selected.assessment.resolutionHeight === "number" &&
          selected.assessment.resolutionHeight > 0;
        return {
          title: selected.candidate.title,
          year: selected.candidate.year,
          candidateId: selected.candidate.id,
          sourceId: selected.candidate.sourceId!,
          resolutionHeight: measured ? selected.assessment.resolutionHeight : null,
          playbackSampleCount: selected.assessment.resolutionSource === "decoded_playback" ? selected.assessment.playbackSampleCount : null,
          selectionBasis: assessmentEvidenceRank(selected.assessment) === 2 && measured ? "decoded-playback" as const : assessmentEvidenceRank(selected.assessment) === 1 && measured ? "source-probe" as const : "reachable-only" as const,
          alternativeCount: Math.max(0, group.length - 1),
          requiresUserConfirmation: true as const,
        };
      });

      await context.checkpoint({ recommendationCount: recommendations.length });
      return {
        ready: true,
        recommendations,
        reason: recommendations.length
          ? "Selected the reachable candidate with the highest measured manifest/segment resolution; unknown resolution is never presented as measured."
          : "No candidate has both a completed quality assessment and a reachable source.",
      };
    },
  };

  return [searchAgent, sourceAgent, qualityAgent, reviewAgent, playbackAgent, createPlaybackEvidenceAgent()];
}
