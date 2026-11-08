import { describe, expect, it } from "vitest";
import { DagExecutionError, runFridayDag, type FridayAgent, type AgentExecutionContext } from "./dag-orchestrator";
import { reduceTaskEvents, TaskRuntime, type TaskDefinition, type TaskEvent, type TaskEventStore } from "./task-runtime";

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

  it("marks downstream tasks cancelled when the workflow is aborted", async () => {
    const store = new MemoryStore();
    const runtime = new TaskRuntime(store);
    const controller = new AbortController();
    let downstreamCalled = false;
    const result = await runFridayDag({
      tasks: [
        { taskId: "search", agent: "search-agent", input: {} },
        { taskId: "quality", agent: "quality-agent", input: {}, dependsOn: ["search"] },
      ],
      runtime,
      signal: controller.signal,
      agents: [
        { id: "search-agent", execute: async () => { controller.abort(); return { candidates: [] }; } },
        { id: "quality-agent", execute: async () => { downstreamCalled = true; return {}; } },
      ],
    });
    expect(downstreamCalled).toBe(false);
    expect(result).toMatchObject([
      { taskId: "search", status: "cancelled" },
      { taskId: "quality", status: "cancelled" },
    ]);
    expect(reduceTaskEvents({ taskId: "quality", agent: "quality-agent", input: {} }, await store.read("quality"))).toMatchObject({ status: "cancelled" });
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
  it("retries only explicitly transient failures and records replay lineage", async () => {
    const store = new MemoryStore();
    const runtime = new TaskRuntime(store);
    let calls = 0;
    const result = await runFridayDag({
      tasks: [{ taskId: "transient", agent: "transient-agent", input: {} }],
      runtime,
      agents: [{
        id: "transient-agent",
        execute: async () => {
          calls += 1;
          if (calls === 1) throw new DagExecutionError("Upstream temporarily unavailable", "UPSTREAM_503", true);
          return { ok: true };
        },
      }],
      maxAttempts: 2,
    });
    expect(calls).toBe(2);
    expect(result[0]).toMatchObject({ status: "succeeded", attempts: 2, output: { ok: true } });
    expect((await store.read("transient")).map((event) => event.type)).toEqual([
      "task.created", "task.started", "task.failed", "task.replay_requested", "task.resumed", "task.succeeded",
    ]);
  });

  it("replays only failed retryable nodes and reuses successful dependency outputs", async () => {
    const store = new MemoryStore();
    const runtime = new TaskRuntime(store);
    const tasks: TaskDefinition[] = [
      { taskId: "search", agent: "search-agent", input: {} },
      { taskId: "probe", agent: "probe-agent", input: {}, dependsOn: ["search"] },
      { taskId: "quality", agent: "quality-agent", input: {}, dependsOn: ["probe"] },
    ];
    let searchCalls = 0;
    let probeCalls = 0;
    const agents: FridayAgent[] = [
      { id: "search-agent", execute: async () => { searchCalls += 1; return { candidates: ["a"] }; } },
      { id: "probe-agent", execute: async () => {
        probeCalls += 1;
        if (probeCalls === 1) throw new DagExecutionError("Temporary upstream failure", "UPSTREAM_503", true);
        return { probes: ["p"] };
      } },
      { id: "quality-agent", execute: async (context: AgentExecutionContext) => ({ assessed: context.dependencyOutputs.probe }) },
    ];
    const first = await runFridayDag({ tasks, runtime, agents, maxAttempts: 1 });
    expect(first.map((item) => item.status)).toEqual(["succeeded", "failed", "failed"]);
    expect(first[1].error).toMatchObject({ retryable: true });
    expect(first[2].error).toMatchObject({ code: "DEPENDENCY_FAILED", retryable: true });

    const replay = await runFridayDag({ tasks, runtime, agents, maxAttempts: 1, replayFailed: true });
    expect(replay.map((item) => item.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(replay[0]).toMatchObject({ attempts: 0, output: { candidates: ["a"] } });
    expect(searchCalls).toBe(1);
    expect(probeCalls).toBe(2);
    expect((await store.read("probe")).map((event) => event.type)).toContain("task.replay_requested");
    expect((await store.read("quality")).map((event) => event.type)).toContain("task.replay_requested");
  });

  it("refuses to replay side-effect tasks even when their stored error is marked retryable", async () => {
    const store = new MemoryStore();
    const runtime = new TaskRuntime(store);
    const task = { taskId: "unsafe", agent: "agent", input: {}, sideEffect: true };
    await runtime.create(task);
    await runtime.record(task, "task.started");
    await runtime.record(task, "task.failed", undefined, { code: "TEMP", message: "Temporary", retryable: true });
    await expect(runFridayDag({
      tasks: [task], runtime, replayFailed: true,
      agents: [{ id: "agent", execute: async () => ({ ok: true }) }],
    })).rejects.toMatchObject({ code: "REPLAY_STATE_INVALID" });
  });

  it("does not retry side-effect failures even when explicitly transient", async () => {
    const store = new MemoryStore();
    const runtime = new TaskRuntime(store);
    let calls = 0;
    const result = await runFridayDag({
      tasks: [{ taskId: "side-effect", agent: "side-agent", input: {}, sideEffect: true }],
      runtime,
      agents: [{
        id: "side-agent",
        execute: async () => {
          calls += 1;
          throw new DagExecutionError("Temporary", "TEMPORARY", true);
        },
      }],
    });
    expect(calls).toBe(1);
    expect(result[0]).toMatchObject({ status: "failed", attempts: 1, error: { retryable: false } });
  });

});