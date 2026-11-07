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

  it("reviews search and quality evidence without inventing missing measurements", async () => {
    const agents = createMovieAgentRegistry({ search: async () => [], probe: async () => [] });
    const review = agents.find((agent) => agent.id === "review-agent")!;
    const result = await review.execute(context("review-agent", {}, {
      search: { candidates: [{ id: "m1", title: "Arrival", sourceId: "s1" }] },
      quality: { assessments: [{ sourceId: "s1", status: "unknown", resolutionHeight: null, latencyMs: null, reachable: null, advertisedQualities: ["4K"], evidence: [] }] },
    })) as { accepted: boolean; unmatchedCandidates: string[] };
    expect(result).toMatchObject({ accepted: true, unmatchedCandidates: [] });
  });
});
