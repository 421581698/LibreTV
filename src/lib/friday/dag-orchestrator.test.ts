import { describe, expect, it } from "vitest";
import { runFridayDag } from "./dag-orchestrator";
import { TaskRuntime, type TaskDefinition, type TaskEvent, type TaskEventStore } from "./task-runtime";

class MemoryStore implements TaskEventStore {
  private events = new Map<string, TaskEvent[]>();
  async append(event: TaskEvent) {
    const list = this.events.get(event.taskId) ?? [];
    list.push(event);
    this.events.set(event.taskId, list);
  }
  async read(taskId: string) { return [...(this.events.get(taskId) ?? [])]; }
}

describe("Friday DAG orchestrator", () => {
  it("runs dependent agents in order and passes dependency outputs", async () => {
    const store = new MemoryStore();
    const runtime = new TaskRuntime(store);
    const tasks: TaskDefinition[] = [
      { taskId: "search", agent: "search-agent", input: { title: "Arrival" } },
      { taskId: "review", agent: "review-agent", input: {}, dependsOn: ["search"] },
    ];
    const order: string[] = [];
    const result = await runFridayDag({
      tasks,
      runtime,
      agents: [
        { id: "search-agent", execute: async () => { order.push("search"); return { count: 2 }; } },
        { id: "review-agent", execute: async ({ dependencyOutputs }) => { order.push("review"); return dependencyOutputs.search; } },
      ],
    });
    expect(order).toEqual(["search", "review"]);
    expect(result[1]).toMatchObject({ status: "succeeded", output: { count: 2 } });
  });

  it("does not execute a dependent agent after its prerequisite fails", async () => {
    const store = new MemoryStore();
    const runtime = new TaskRuntime(store);
    let downstreamCalled = false;
    const result = await runFridayDag({
      tasks: [
        { taskId: "probe", agent: "probe-agent", input: {} },
        { taskId: "quality", agent: "quality-agent", input: {}, dependsOn: ["probe"] },
      ],
      runtime,
      agents: [
        { id: "probe-agent", execute: async () => { throw new Error("probe timeout"); } },
        { id: "quality-agent", execute: async () => { downstreamCalled = true; return {}; } },
      ],
    });
    expect(downstreamCalled).toBe(false);
    expect(result[1]).toMatchObject({ status: "failed", error: { code: "DEPENDENCY_FAILED" } });
  });
});
