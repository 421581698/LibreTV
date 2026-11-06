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
      { id: "alpha:1", title: "Arrival", sourceId: "alpha", evidence: ["GET /api/search"] },
    ]);
    expect(fetcher).toHaveBeenCalledWith("/api/search", expect.objectContaining({
      method: "POST",
      cache: "no-store",
    }));
  });

  it("probes each used source once through the guarded source-test endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true, ms: 125, count: 3,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapters = createLibreTVMovieAgentAdapters(sources, { fetcher });
    const result = await adapters.probe({ candidates: [
      { id: "alpha:1", title: "Arrival", sourceId: "alpha" },
      { id: "alpha:2", title: "Dune", sourceId: "alpha" },
    ] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceId: "alpha", reachable: true, latencyMs: 125, statusCode: 200 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/source/test", expect.objectContaining({ method: "POST" }));
  });

  it("does not turn an HTTP failure into a reachable source", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: false, ms: 80, error: "HTTP 403",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapters = createLibreTVMovieAgentAdapters(sources, { fetcher });
    const result = await adapters.probe({ candidates: [{ id: "alpha:1", title: "Arrival", sourceId: "alpha" }] });
    expect(result[0]).toMatchObject({ reachable: false, latencyMs: 80 });
  });
});
