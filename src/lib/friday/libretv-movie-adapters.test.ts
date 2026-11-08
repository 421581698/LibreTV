import { describe, expect, it, vi } from "vitest";
import { createLibreTVMovieAgentAdapters } from "./libretv-movie-adapters";
import type { SourceConfig } from "../types";

const sources: SourceConfig[] = [
  { key: "alpha", name: "Alpha", url: "https://alpha.example/api.php/provide/vod" },
];

describe("LibreTV movie agent adapters", () => {
  it("maps real search API results into candidates", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      list: [{ sourceKey: "alpha", sourceName: "Alpha", vodId: "1", name: "Arrival", year: "2024", sourceUrl: sources[0].url }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapters = createLibreTVMovieAgentAdapters(sources, { fetcher });
    await expect(adapters.search({ query: "Arrival" })).resolves.toMatchObject([
      { id: "alpha:1", vodId: "1", title: "Arrival", year: "2024", sourceId: "alpha", evidence: ["GET /api/search"] },
    ]);
    expect(fetcher).toHaveBeenCalledWith("/api/search", expect.objectContaining({
      method: "POST",
      cache: "no-store",
    }));
  });

  it("uses the existing per-movie quality endpoint and maps extracted resolution", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      results: [{ sourceKey: "alpha", vodId: "1", height: 1080, probeDurationMs: 240, upstreamRequestMs: 92, upstreamRequestCount: 3 }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapters = createLibreTVMovieAgentAdapters(sources, { fetcher });
    const result = await adapters.probe({ candidates: [
      { id: "alpha:1", vodId: "1", title: "Arrival", sourceId: "alpha" },
    ] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sourceId: "alpha",
      candidateId: "alpha:1",
      reachable: true,
      resolutionHeight: 1080,
      probeDurationMs: 240,
      upstreamRequestMs: 92,
      upstreamRequestCount: 3,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/quality", expect.objectContaining({
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ items: [{ source: sources[0], id: "1" }] }),
    }));
  });

  it("includes accumulated decoded playback samples separately from source resolution", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      results: [{ sourceKey: "alpha", vodId: "1", height: 2160 }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapters = createLibreTVMovieAgentAdapters(sources, {
      fetcher,
      readPlaybackEvidence: () => ({
        from: "play",
        height: 720,
        playbackSampleCount: 4,
        playbackMinHeight: 480,
        playbackMaxHeight: 1080,
        lastPlaybackHeight: 720,
        lastPlaybackSampleAt: 1_794_000_000_000,
        timestamp: 1_794_000_000_000,
      }),
    });
    const result = await adapters.probe({
      candidates: [{ id: "alpha:1", vodId: "1", title: "Arrival", sourceId: "alpha" }],
    });
    expect(result[0]).toMatchObject({
      resolutionHeight: 2160,
      decodedResolutionHeight: 720,
      playbackSampleCount: 4,
      playbackMinHeight: 480,
      playbackMaxHeight: 1080,
      lastPlaybackHeight: 720,
    });
  });

  it("keeps resolution unknown when the endpoint completes without a height", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      results: [{ sourceKey: "alpha", vodId: "1" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapters = createLibreTVMovieAgentAdapters(sources, { fetcher });
    const result = await adapters.probe({ candidates: [{ id: "alpha:1", vodId: "1", title: "Arrival", sourceId: "alpha" }] });
    expect(result[0]).toMatchObject({ reachable: true, resolutionProbed: true });
    expect(result[0].resolutionHeight).toBeUndefined();
    expect(result[0].resolutionError).toBeUndefined();
  });

  it.each([408, 425, 429, 502])("classifies transient quality HTTP %i as retryable", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("upstream error", { status }));
    const adapters = createLibreTVMovieAgentAdapters(sources, { fetcher });
    await expect(adapters.probe({
      candidates: [{ id: "alpha:1", vodId: "1", title: "Arrival", sourceId: "alpha" }],
    })).rejects.toMatchObject({ code: "QUALITY_HTTP_ERROR", retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
