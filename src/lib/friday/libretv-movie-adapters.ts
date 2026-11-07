import type { SearchResultItem, SourceConfig, QualityProbeResult } from "../types";
import type { MovieAgentAdapters, MovieCandidate, SourceProbe } from "./movie-agents";
import { DagExecutionError } from "./dag-orchestrator";

type SearchApiResponse = { list?: SearchResultItem[]; failures?: Array<{ sourceKey: string; error: string }> };
type QualityApiResponse = { results?: QualityProbeResult[] };

async function readJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("LibreTV API returned a non-JSON response");
  }
  return response.json() as Promise<T>;
}

/**
 * Browser-side adapters for LibreTV APIs.
 * Resolution probing uses /api/quality, whose server implementation applies
 * SSRF checks and parses HLS master playlists or media-segment headers.
 */
export function createLibreTVMovieAgentAdapters(
  sources: SourceConfig[],
  options: { filterAdult?: boolean; fetcher?: typeof fetch } = {},
): MovieAgentAdapters {
  const fetcher = options.fetcher ?? fetch;

  return {
    async search({ query }, signal): Promise<MovieCandidate[]> {
      let response: Response;
      try {
        response = await fetcher("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ wd: query, sources, filterAdult: options.filterAdult === true }),
        signal,
        cache: "no-store",
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new DagExecutionError(
          error instanceof Error ? error.message : "Search network request failed",
          "SEARCH_NETWORK_ERROR",
          true,
        );
      }
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new DagExecutionError(`Search API failed: HTTP ${response.status}`, "SEARCH_HTTP_ERROR", retryable);
      }
      const payload = await readJson<SearchApiResponse>(response);
      return (Array.isArray(payload.list) ? payload.list : []).map((item) => ({
        id: `${item.sourceKey}:${item.vodId}`,
        vodId: String(item.vodId),
        title: item.name,
        sourceId: item.sourceKey,
        sourceUrl: item.sourceUrl,
        evidence: ["GET /api/search"],
      }));
    },

    async probe({ candidates }, signal): Promise<SourceProbe[]> {
      const sourceByKey = new Map(sources.map((source) => [source.key, source]));
      const unique = new Map<string, { source: SourceConfig; candidate: MovieCandidate; id: string }>();
      for (const candidate of candidates) {
        const source = candidate.sourceId ? sourceByKey.get(candidate.sourceId) : undefined;
        const id = candidate.vodId || candidate.id.split(":").slice(1).join(":");
        if (!source || !id) continue;
        unique.set(`${source.key}:${id}`, { source, candidate, id });
      }
      const entries = Array.from(unique.values());
      if (entries.length === 0) return [];

      const output: SourceProbe[] = [];
      // /api/quality accepts at most 50 movie/source pairs per request.
      for (let offset = 0; offset < entries.length; offset += 50) {
        const batch = entries.slice(offset, offset + 50);
        try {
          const response = await fetcher("/api/quality", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              items: batch.map(({ source, id }) => ({ source, id })),
            }),
            signal,
            cache: "no-store",
          });
          if (!response.ok) {
            const retryable = response.status === 429 || response.status >= 500;
            throw new DagExecutionError(`Quality probe failed: HTTP ${response.status}`, "QUALITY_HTTP_ERROR", retryable);
          }
          const payload = await readJson<QualityApiResponse>(response);
          const results = new Map(
            (Array.isArray(payload.results) ? payload.results : [])
              .map((item): [string, QualityProbeResult] => [`${item.sourceKey}:${item.vodId}`, item]),
          );
          output.push(...batch.map(({ source, candidate, id }) => {
            const result = results.get(`${source.key}:${id}`);
            return {
              sourceId: source.key,
              candidateId: candidate.id,
              title: candidate.title,
              checkedAt: new Date().toISOString(),
              reachable: Boolean(result && !result.error),
              resolutionHeight: typeof result?.height === "number" ? result.height : undefined,
              resolutionProbed: Boolean(result && !result.error),
              probeDurationMs: result?.probeDurationMs,
              probeResultCached: result?.cached,
              resolutionError: result?.error ?? (result ? undefined : "No quality result returned"),
            };
          }));
        } catch (error) {
          if (signal?.aborted) throw error;
          if (error instanceof DagExecutionError && error.retryable) throw error;
          if (error instanceof TypeError) {
            throw new DagExecutionError(error.message || "Quality probe network request failed", "QUALITY_NETWORK_ERROR", true);
          }
          output.push(...batch.map(({ source, candidate }) => ({
            sourceId: source.key,
            candidateId: candidate.id,
            title: candidate.title,
            checkedAt: new Date().toISOString(),
            reachable: false,
            resolutionError: error instanceof Error ? error.message : "画质探测请求失败",
          })));
        }
      }
      return output;
    },
  };
}
