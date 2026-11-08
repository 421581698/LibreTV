import { describe, expect, it, vi } from "vitest";
import { createLibreTVMovieAgentAdapters } from "./libretv-movie-adapters";
import type { SourceConfig } from "../types";
import { createMovieWorkflowTaskIdPrefix, runLibreTVMovieWorkflow } from "./movie-workflow";
import { TaskRuntime, type TaskEvent, type TaskEventStore } from "./task-runtime";

class MemoryStore implements TaskEventStore {
  private events = new Map<string, TaskEvent[]>();
  async append(event: TaskEvent) {
    const list = this.events.get(event.taskId) ?? [];
    list.push(event);
    this.events.set(event.taskId, list);
  }
  async read(taskId: string) {
    return [...(this.events.get(taskId) ?? [])];
  }
}

describe("LibreTV movie workflow", () => {
  it("creates distinct task namespaces even within the same millisecond", () => {
    const first = createMovieWorkflowTaskIdPrefix(1234, "00000000-0000-4000-8000-000000000001");
    const second = createMovieWorkflowTaskIdPrefix(1234, "00000000-0000-4000-8000-000000000002");
    expect(first).not.toBe(second);
    expect(first).toBe("friday-1234-00000000-0000-4000-8000-000000000001");
  });

  it("executes search, source probe, quality assessment and review as persisted DAG tasks", async () => {
    const store = new MemoryStore();
    const runtime = new TaskRuntime(store);
    const calls: string[] = [];

    const result = await runLibreTVMovieWorkflow({
      query: "Arrival",
      taskIdPrefix: "request-001",
      runtime,
      adapters: {
        search: async ({ query }) => {
          calls.push("search");
          return [{ id: "alpha:1", title: query, sourceId: "alpha" }];
        },
        probe: async ({ candidates }) => {
          calls.push("probe");
          expect(candidates).toHaveLength(1);
          return [{
            sourceId: "alpha",
            candidateId: "alpha:1",
            resolutionProbed: true,
            checkedAt: "2026-11-06T00:00:00.000Z",
            reachable: true,
            latencyMs: 120,
            statusCode: 200,
          }];
        },
      },
    });

    expect(calls).toEqual(["search", "probe"]);
    expect(result.results.map((item) => item.status)).toEqual([
      "succeeded", "succeeded", "succeeded", "succeeded", "succeeded",
    ]);
    expect(result.results[3].output).toMatchObject({
      accepted: true,
      candidateCount: 1,
      assessmentCount: 1,
      measurementCompleted: true,
      resolutionMeasured: false,
    });

    expect(result.results[4].output).toMatchObject({
      ready: true,
      recommendations: [{
        candidateId: "alpha:1",
        sourceId: "alpha",
        selectionBasis: "reachable-only",
        requiresUserConfirmation: true,
      }],
    });
    const expectedEvents = {
      [result.taskIds.search]: [
        "task.created",
        "task.started",
        "task.progress",
        "task.checkpoint",
        "task.succeeded",
      ],
      [result.taskIds.source]: [
        "task.created",
        "task.started",
        "task.progress",
        "task.succeeded",
      ],
      [result.taskIds.quality]: [
        "task.created",
        "task.started",
        "task.checkpoint",
        "task.succeeded",
      ],
      [result.taskIds.review]: [
        "task.created",
        "task.started",
        "task.checkpoint",
        "task.succeeded",
      ],
      [result.taskIds.playback]: [
        "task.created",
        "task.started",
        "task.checkpoint",
        "task.succeeded",
      ],
    } as const;

    for (const [taskId, expected] of Object.entries(expectedEvents)) {
      const events = await store.read(taskId);
      expect(events.map((event) => event.type)).toEqual(expected);
    }
  });

  it("integrates the real LibreTV search and quality adapters through all five persisted agents", async () => {
    const source: SourceConfig = { key: "alpha", name: "Alpha", url: "https://alpha.example/api.php/provide/vod" };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input) === "/api/search") {
        return new Response(JSON.stringify({
          list: [{ sourceKey: "alpha", sourceName: "Alpha", vodId: "1", name: "Arrival", year: "2016", sourceUrl: source.url }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(input) === "/api/quality") {
        return new Response(JSON.stringify({
          results: [{
            sourceKey: "alpha", vodId: "1", height: 1080,
            probeDurationMs: 240, upstreamRequestMs: 92, upstreamRequestCount: 3,
            cached: false, transient: false,
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected adapter request: ${String(input)}`);
    });
    const store = new MemoryStore();
    const result = await runLibreTVMovieWorkflow({
      query: "Arrival",
      taskIdPrefix: "adapter-e2e",
      runtime: new TaskRuntime(store),
      adapters: createLibreTVMovieAgentAdapters([source], { fetcher }),
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.results.map((item) => item.status)).toEqual([
      "succeeded", "succeeded", "succeeded", "succeeded", "succeeded",
    ]);
    expect(result.results[2].output).toMatchObject({
      assessments: [{
        status: "resolution_detected",
        resolutionHeight: 1080,
        probeDurationMs: 240,
        upstreamRequestMs: 92,
        upstreamRequestCount: 3,
        evidence: expect.arrayContaining(["quality_probe.upstream_request_ms"]),
      }],
    });
    expect(result.results[4].output).toMatchObject({
      ready: true,
      recommendations: [{ candidateId: "alpha:1", selectionBasis: "measured-resolution", resolutionHeight: 1080 }],
    });
    for (const taskId of Object.values(result.taskIds)) {
      expect((await store.read(taskId)).at(-1)?.type).toBe("task.succeeded");
    }
  });

  it("prefers stored decoded videoHeight while preserving source resolution and origin timing", async () => {
    const store = new MemoryStore();
    const workflow = await runLibreTVMovieWorkflow({
      query: "Arrival",
      taskIdPrefix: "decoded-quality-e2e",
      runtime: new TaskRuntime(store),
      adapters: {
        search: async ({ query }) => [{
          id: "alpha:arrival",
          title: query,
          sourceId: "alpha",
          vodId: "arrival",
        }],
        probe: async () => [{
          sourceId: "alpha",
          candidateId: "alpha:arrival",
          title: "Arrival",
          checkedAt: "2026-11-08T00:00:00.000Z",
          reachable: true,
          resolutionProbed: true,
          resolutionHeight: 1080,
          decodedResolutionHeight: 720,
          originTtfbMs: 64,
          probeDurationMs: 438,
          upstreamRequestMs: 91,
          upstreamRequestCount: 3,
        }],
      },
    });

    const quality = workflow.results.find((item) => item.taskId === workflow.taskIds.quality)?.output as {
      assessments: Array<Record<string, unknown>>;
    };
    expect(quality.assessments[0]).toMatchObject({
      status: "resolution_detected",
      resolutionHeight: 720,
      decodedResolutionHeight: 720,
      sourceResolutionHeight: 1080,
      resolutionSource: "decoded_playback",
      originTtfbMs: 64,
      probeDurationMs: 438,
      upstreamRequestMs: 91,
      upstreamRequestCount: 3,
    });
    expect(quality.assessments[0].evidence).toEqual(expect.arrayContaining([
      "player.videoHeight",
      "hls_or_segment.resolution_height",
      "origin.media_ttfb_ms",
    ]));
    const playback = workflow.results.find((item) => item.taskId === workflow.taskIds.playback)?.output as {
      recommendations: Array<{ resolutionHeight: number | null; selectionBasis: string }>;
    };
    expect(playback.recommendations[0]).toMatchObject({
      resolutionHeight: 720,
      selectionBasis: "measured-resolution",
    });
  });

  it("persists the workflow DAG as an explicit parent-child lineage", async () => {
    const store = new MemoryStore();
    const result = await runLibreTVMovieWorkflow({
      query: "Arrival", taskIdPrefix: "lineage-001", parentTaskId: "parent-search",
      runtime: new TaskRuntime(store),
      adapters: {
        search: async ({ query }) => [{ id: "alpha:1", title: query, sourceId: "alpha" }],
        probe: async () => [{ sourceId: "alpha", candidateId: "alpha:1", checkedAt: "now", reachable: true, resolutionProbed: true }],
      },
    });
    const search = await store.read(result.taskIds.search);
    const source = await store.read(result.taskIds.source);
    const quality = await store.read(result.taskIds.quality);
    const review = await store.read(result.taskIds.review);
    expect(search[0].parentTaskId).toBe("parent-search");
    expect(source[0].parentTaskId).toBe(result.taskIds.search);
    expect(quality[0].parentTaskId).toBe(result.taskIds.source);
    expect(review[0].parentTaskId).toBe(result.taskIds.quality);
  });

  it("rejects blank query and blank task prefix before writing events", async () => {
    const store = new MemoryStore();
    const runtime = new TaskRuntime(store);
    const adapters = { search: async () => [], probe: async () => [] };
    await expect(runLibreTVMovieWorkflow({
      query: " ", taskIdPrefix: "request-002", runtime, adapters,
    })).rejects.toThrow("non-empty query");
    await expect(runLibreTVMovieWorkflow({
      query: "Arrival", taskIdPrefix: " ", runtime, adapters,
    })).rejects.toThrow("task ID prefix");
    expect(await store.read("request-002.search")).toEqual([]);
  });
});
