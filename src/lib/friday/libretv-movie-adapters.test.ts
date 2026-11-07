import { describe, expect, it, vi } from "vitest";
import { createLibreTVMovieAgentAdapters } from "./libretv-movie-adapters";
import type { SourceConfig } from "../types";

const sources: SourceConfig[] = [
  { key: "alpha", name: "Alpha", url: "https://alpha.example/api.php/provide/vod" },
];

describe("LibreTV movie agent adapters", () => {
  it("maps real search API results into candidates", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      list: [{ sourceKey: "alpha", sourceName: "Alpha", vodId: "1", name: "Arrival", sourceUrl: sources[0].url }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapters = createLibreTVMovieAgentAdapters(sources, { fetcher });
    await expect(adapters.search({ query: "Arrival" })).resolves.toMatchObject([
      { id: "alpha:1", vodId: "1", title: "Arrival", sourceId: "alpha", evidence: ["GET /api/search"] },
    ]);
    expect(fetcher).toHaveBeenCalledWith("/api/search", expect.objectContaining({
      method: "POST",
      cache: "no-store",
    }));
  });

  it("uses the existing per-movie quality endpoint and maps extracted resolution", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      results: [{ sourceKey: "alpha", vodId: "1", height: 1080 }],
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
    });
    expect(fetcher).toHaveBeenCalledWith("/api/quality", expect.objectContaining({
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ items: [{ source: sources[0], id: "1" }] }),
    }));
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

  it("does not turn an HTTP failure into a reachable source", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad gateway", { status: 502 }));
    const adapters = createLibreTVMovieAgentAdapters(sources, { fetcher });
    await expect(adapters.probe({ candidates: [{ id: "alpha:1", vodId: "1", title: "Arrival", sourceId: "alpha" }] }))
      .rejects.toMatchObject({ code: "QUALITY_HTTP_ERROR", retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
