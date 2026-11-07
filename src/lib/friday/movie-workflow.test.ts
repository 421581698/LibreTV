import { describe, expect, it } from "vitest";
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
      "succeeded", "succeeded", "succeeded", "succeeded",
    ]);
    expect(result.results[3].output).toMatchObject({
      accepted: true,
      candidateCount: 1,
      assessmentCount: 1,
      measurementCompleted: true,
      resolutionMeasured: false,
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
        "task.succeeded",
      ],
      [result.taskIds.review]: [
        "task.created",
        "task.started",
        "task.succeeded",
      ],
    } as const;

    for (const [taskId, expected] of Object.entries(expectedEvents)) {
      const events = await store.read(taskId);
      expect(events.map((event) => event.type)).toEqual(expected);
    }
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
