import { describe, expect, it } from "vitest";
import { runLibreTVMovieWorkflow } from "./movie-workflow";
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
    });

    for (const taskId of Object.values(result.taskIds)) {
      const events = await store.read(taskId);
      expect(events.map((event) => event.type)).toEqual([
        "task.created", "task.started", "task.succeeded",
      ]);
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
