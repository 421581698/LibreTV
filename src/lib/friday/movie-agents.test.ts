import { describe, expect, it } from "vitest";
import { createMovieAgentRegistry } from "./movie-agents";
import type { AgentExecutionContext } from "./dag-orchestrator";

function context(agent: string, input: unknown, dependencyOutputs: Record<string, unknown> = {}): AgentExecutionContext {
  return {
    task: { taskId: "test", agent, input },
    dependencyOutputs,
    progress: async () => undefined,
    checkpoint: async () => undefined,
  };
}

describe("Friday movie agents", () => {
  it("searches through the injected existing-search adapter", async () => {
    const agents = createMovieAgentRegistry({
      search: async ({ query }) => [{ id: "m1", title: query }],
      probe: async () => [],
    });
    const result = await agents.find((agent) => agent.id === "search-agent")!.execute(
      context("search-agent", { query: "Arrival" }),
    );
    expect(result).toMatchObject({ query: "Arrival", candidates: [{ id: "m1" }] });
  });

  it("keeps quality unknown when the probe supplies no measurements", async () => {
    const agents = createMovieAgentRegistry({ search: async () => [], probe: async () => [] });
    const quality = agents.find((agent) => agent.id === "quality-agent")!;
    const result = await quality.execute(context("quality-agent", {}, {
      source: { probes: [{ sourceId: "s1", checkedAt: "2026-11-06T00:00:00Z" }] },
    })) as { assessments: Array<{ status: string; latencyMs: number | null; reachable: boolean | null }> };
    expect(result.assessments[0]).toMatchObject({ status: "unknown", latencyMs: null, reachable: null });
  });

  it("does not treat source probing or an advertised 4K label as measured resolution", async () => {
    const agents = createMovieAgentRegistry({ search: async () => [], probe: async () => [] });
    const quality = agents.find((agent) => agent.id === "quality-agent")!;
    const result = await quality.execute(context("quality-agent", {}, {
      source: { probes: [{ sourceId: "s1", checkedAt: "now", advertisedQualities: ["4K"] }] },
    })) as { assessments: Array<{ status: string; advertisedQualities: string[]; evidence: string[] }> };
    expect(result.assessments[0]).toMatchObject({
      status: "unknown",
      advertisedQualities: ["4K"],
      evidence: [],
    });
  });

  it("recognizes parsed HLS or segment resolution without claiming playback measurement", async () => {
    const agents = createMovieAgentRegistry({ search: async () => [], probe: async () => [] });
    const quality = agents.find((agent) => agent.id === "quality-agent")!;
    const result = await quality.execute(context("quality-agent", {}, {
      source: { probes: [{
        sourceId: "s1",
        checkedAt: "now",
        reachable: true,
        resolutionProbed: true,
        resolutionHeight: 1080,
      }] },
    })) as { assessments: Array<{ status: string; resolutionHeight: number | null; evidence: string[] }> };
    expect(result.assessments[0]).toMatchObject({
      status: "resolution_detected",
      resolutionHeight: 1080,
      evidence: ["quality_probe.completed", "hls_or_segment.resolution_height", "source.reachable"],
    });
  });

  it("keeps completed-but-unparseable resolution unknown", async () => {
    const agents = createMovieAgentRegistry({ search: async () => [], probe: async () => [] });
    const quality = agents.find((agent) => agent.id === "quality-agent")!;
    const result = await quality.execute(context("quality-agent", {}, {
      source: { probes: [{ sourceId: "s1", checkedAt: "now", reachable: true, resolutionProbed: true }] },
    })) as { assessments: Array<{ status: string; resolutionHeight: number | null }> };
    expect(result.assessments[0]).toMatchObject({ status: "resolution_unknown", resolutionHeight: null });
  });

  it("rejects duplicate and orphan candidate assessments instead of accepting partial coverage", async () => {
    const agents = createMovieAgentRegistry({ search: async () => [], probe: async () => [] });
    const review = agents.find((agent) => agent.id === "review-agent")!;
    const assessment = {
      sourceId: "s1", candidateId: "m1", status: "resolution_unknown" as const,
      assessmentCompleted: true, resolutionHeight: null, latencyMs: null,
      probeDurationMs: null, probeResultCached: null, reachable: true,
      advertisedQualities: [], evidence: ["quality_probe.completed"],
    };
    const result = await review.execute(context("review-agent", {}, {
      search: { candidates: [{ id: "m1", title: "Arrival" }] },
      quality: { assessments: [assessment, assessment, { ...assessment, candidateId: "unknown" }] },
    })) as { accepted: boolean; findings: string[]; assessmentCount: number; measurementCompleted: boolean };
    expect(result.accepted).toBe(false);
    expect(result.assessmentCount).toBe(3);
    expect(result.measurementCompleted).toBe(false);
    expect(result.findings).toContain("duplicate-candidate-assessment");
    expect(result.findings).toContain("assessment-for-unknown-candidate");
  });

  it("requires resolution evidence and a positive measured height for detected resolution", async () => {
    const agents = createMovieAgentRegistry({ search: async () => [], probe: async () => [] });
    const review = agents.find((agent) => agent.id === "review-agent")!;
    const result = await review.execute(context("review-agent", {}, {
      search: { candidates: [{ id: "m1", title: "Arrival" }] },
      quality: { assessments: [{
        sourceId: "s1", candidateId: "m1", status: "resolution_detected",
        assessmentCompleted: true, resolutionHeight: 1080, latencyMs: null,
        probeDurationMs: null, probeResultCached: null, reachable: true,
        advertisedQualities: [], evidence: ["source.reachable"],
      }] },
    })) as { accepted: boolean; findings: string[] };
    expect(result.accepted).toBe(false);
    expect(result.findings).toContain("measurement-without-resolution-evidence");
  });

  it("reviews search and quality evidence without inventing missing measurements", async () => {
    const agents = createMovieAgentRegistry({ search: async () => [], probe: async () => [] });
    const review = agents.find((agent) => agent.id === "review-agent")!;
    const result = await review.execute(context("review-agent", {}, {
      search: { candidates: [{ id: "m1", title: "Arrival", sourceId: "s1" }] },
      // No candidateId: a source-level assessment cannot be attributed to this movie.
      quality: { assessments: [{ sourceId: "s1", status: "unknown", assessmentCompleted: true, resolutionHeight: null, latencyMs: null, probeDurationMs: null, probeResultCached: null, reachable: null, advertisedQualities: ["4K"], evidence: [] }] },
    })) as { accepted: boolean; unmatchedCandidates: string[]; findings: string[]; measurementCompleted: boolean; resolutionMeasured: boolean };
    expect(result).toMatchObject({ accepted: false, unmatchedCandidates: ["m1"], measurementCompleted: false, resolutionMeasured: false });
    expect(result.findings).toContain("candidate-without-quality-assessment");
  });
  it("recommends the reachable candidate with the highest measured resolution", async () => {
    const agents = createMovieAgentRegistry({ search: async () => [], probe: async () => [] });
    const playback = agents.find((agent) => agent.id === "playback-agent")!;
    const result = await playback.execute(context("playback-agent", {}, {
      search: { candidates: [
        { id: "source-a:1", title: "Arrival", sourceId: "source-a" },
        { id: "source-b:9", title: "Arrival", sourceId: "source-b" },
      ] },
      quality: { assessments: [
        {
          sourceId: "source-a", candidateId: "source-a:1", title: "Arrival",
          status: "resolution_detected", assessmentCompleted: true,
          resolutionHeight: 720, latencyMs: null, probeDurationMs: 90,
          probeResultCached: false, reachable: true, advertisedQualities: [],
          evidence: ["hls_or_segment.resolution_height"],
        },
        {
          sourceId: "source-b", candidateId: "source-b:9", title: "Arrival",
          status: "resolution_detected", assessmentCompleted: true,
          resolutionHeight: 1080, latencyMs: null, probeDurationMs: 140,
          probeResultCached: false, reachable: true, advertisedQualities: [],
          evidence: ["hls_or_segment.resolution_height"],
        },
      ] },
      review: { accepted: true },
    })) as { ready: boolean; recommendations: Array<Record<string, unknown>> };
    expect(result.ready).toBe(true);
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      candidateId: "source-b:9",
      sourceId: "source-b",
      resolutionHeight: 1080,
      selectionBasis: "measured-resolution",
      requiresUserConfirmation: true,
    });
  });

  it("withholds playback recommendations when evidence review is rejected", async () => {
    const agents = createMovieAgentRegistry({ search: async () => [], probe: async () => [] });
    const playback = agents.find((agent) => agent.id === "playback-agent")!;
    const result = await playback.execute(context("playback-agent", {}, {
      search: { candidates: [{ id: "source-a:1", title: "Arrival", sourceId: "source-a" }] },
      quality: { assessments: [] },
      review: { accepted: false },
    })) as { ready: boolean; recommendations: unknown[] };
    expect(result).toMatchObject({ ready: false, recommendations: [] });
  });

});
