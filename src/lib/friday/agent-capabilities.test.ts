import { describe, expect, it } from "vitest";
import { runFridayDag } from "./dag-orchestrator";
import { TaskRuntime, type TaskEvent, type TaskEventStore } from "./task-runtime";
import { createMovieAgentRegistry } from "./movie-agents";

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

describe("Friday Agent least-privilege capability boundary", () => {
  it("grants each movie agent only its single declared capability", () => {
    const agents = createMovieAgentRegistry({
      search: async () => [],
      probe: async () => [],
    });
    expect(agents.map((agent) => [agent.id, agent.capabilities])).toEqual([
      ["search-agent", ["movie.search"]],
      ["source-agent", ["source.probe"]],
      ["quality-agent", ["quality.assess"]],
      ["review-agent", ["quality.review"]],
      ["playback-agent", ["playback.recommend"]],
      ["playback-evidence-agent", ["playback.observe"]],
    ]);
  });

  it("denies a capability that was not explicitly granted", async () => {
    const runtime = new TaskRuntime(new MemoryStore());
    const [result] = await runFridayDag({
      runtime,
      tasks: [{ taskId: "capability-denied", agent: "restricted-agent", input: {} }],
      agents: [{
        id: "restricted-agent",
        capabilities: [],
        async execute(context) {
          context.requireCapability("movie.search");
          return { shouldNotRun: true };
        },
      }],
    });

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "AGENT_CAPABILITY_DENIED", retryable: false },
    });
  });

  it("does not expose arbitrary tools or memory to agent execution contexts", async () => {
    const runtime = new TaskRuntime(new MemoryStore());
    let contextKeys: string[] = [];
    await runFridayDag({
      runtime,
      tasks: [{ taskId: "restricted-context", agent: "isolated-agent", input: {} }],
      agents: [{
        id: "isolated-agent",
        capabilities: [],
        async execute(context) {
          contextKeys = Object.keys(context).sort();
          return { ok: true };
        },
      }],
    });

    expect(contextKeys).toEqual([
      "checkpoint",
      "dependencyOutputs",
      "progress",
      "requireCapability",
      "signal",
      "task",
    ]);
    expect(contextKeys).not.toContain("tools");
    expect(contextKeys).not.toContain("memory");
  });
});
