import type { SearchResultItem, SourceConfig } from "../types";
import type { MovieAgentAdapters, MovieCandidate, SourceProbe } from "./movie-agents";

type SearchApiResponse = { list?: SearchResultItem[]; failures?: Array<{ sourceKey: string; error: string }> };
type SourceTestResponse = { ok?: boolean; ms?: number; count?: number; error?: string };

async function readJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("LibreTV API returned a non-JSON response");
  }
  return response.json() as Promise<T>;
}

/**
 * Browser-side adapters for the existing LibreTV endpoints.
 * Source probing is delegated to /api/source/test, which applies the
 * repository's SSRF and upstream-request safety checks on the server.
 */
export function createLibreTVMovieAgentAdapters(
  sources: SourceConfig[],
  options: { filterAdult?: boolean; fetcher?: typeof fetch } = {},
): MovieAgentAdapters {
  const fetcher = options.fetcher ?? fetch;

  return {
    async search({ query }, signal): Promise<MovieCandidate[]> {
      const response = await fetcher("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ wd: query, sources, filterAdult: options.filterAdult === true }),
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Search API failed: HTTP ${response.status}`);
      const payload = await readJson<SearchApiResponse>(response);
      return (Array.isArray(payload.list) ? payload.list : []).map((item) => ({
        id: `${item.sourceKey}:${item.vodId}`,
        title: item.name,
        sourceId: item.sourceKey,
        sourceUrl: item.sourceUrl,
        evidence: ["GET /api/search"],
      }));
    },

    async probe({ candidates }, signal): Promise<SourceProbe[]> {
      const sourceByKey = new Map(sources.map((source) => [source.key, source]));
      const unique = new Map<string, SourceConfig>();
      for (const candidate of candidates) {
        const source = candidate.sourceId ? sourceByKey.get(candidate.sourceId) : undefined;
        if (source) unique.set(source.key, source);
      }

      return Promise.all(Array.from(unique.values()).map(async (source) => {
        const startedAt = Date.now();
        try {
          const response = await fetcher("/api/source/test", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ url: source.url }),
            signal,
            cache: "no-store",
          });
          const payload = await readJson<SourceTestResponse>(response);
          return {
            sourceId: source.key,
            checkedAt: new Date().toISOString(),
            reachable: response.ok && payload.ok === true,
            latencyMs: typeof payload.ms === "number" && Number.isFinite(payload.ms)
              ? payload.ms
              : Date.now() - startedAt,
            statusCode: response.status,
          };
        } catch (error) {
          if (signal?.aborted) throw error;
          return {
            sourceId: source.key,
            checkedAt: new Date().toISOString(),
            reachable: false,
            latencyMs: Date.now() - startedAt,
          };
        }
      }));
    },
  };
}
