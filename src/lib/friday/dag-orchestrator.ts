import {
  TaskRuntime,
  TaskRuntimeError,
  validateTaskGraph,
  type TaskDefinition,
  type TaskSnapshot,
} from "./task-runtime";

export type AgentCapability = "movie.search" | "source.probe" | "quality.assess" | "quality.review" | "playback.recommend";

export type AgentExecutionContext = {
  task: TaskDefinition;
  dependencyOutputs: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
  progress(value: unknown): Promise<void>;
  checkpoint(value: unknown): Promise<void>;
  /** Enforces the least-privilege capability contract declared by this agent. */
  requireCapability(capability: AgentCapability): void;
};

export type FridayAgent = {
  id: string;
  /** No capabilities are granted by default. Memory and arbitrary tool access are intentionally absent. */
  capabilities?: readonly AgentCapability[];
  execute(context: AgentExecutionContext): Promise<unknown>;
};

export type DagRunResult = {
  taskId: string;
  status: "succeeded" | "failed" | "cancelled";
  output?: unknown;
  attempts: number;
  error?: { code: string; message: string; retryable: boolean };
};

export class DagExecutionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "DagExecutionError";
  }
}

/**
 * Executes a validated DAG. Only explicitly classified transient failures are
 * retried. A later explicit replay reuses successful dependency outputs and
 * reruns only failed tasks whose persisted error is retryable.
 * Side-effect tasks are never automatically or manually replayed.
 */
export async function runFridayDag(args: {
  tasks: TaskDefinition[];
  agents: FridayAgent[];
  runtime: TaskRuntime;
  signal?: AbortSignal;
  maxAttempts?: number;
  replayFailed?: boolean;
}): Promise<DagRunResult[]> {
  const { tasks, agents, runtime, signal } = args;
  const requestedAttempts = Number.isFinite(args.maxAttempts) ? Math.floor(args.maxAttempts as number) : 2;
  const maxAttempts = Math.max(1, Math.min(3, requestedAttempts));
  validateTaskGraph(tasks);

  const agentById = new Map<string, FridayAgent>();
  for (const agent of agents) {
    if (!agent.id || agentById.has(agent.id)) {
      throw new DagExecutionError("Duplicate or empty agent registration: " + agent.id, "AGENT_DUPLICATE");
    }
    agentById.set(agent.id, agent);
  }
  for (const task of tasks) {
    if (!agentById.has(task.agent)) {
      throw new DagExecutionError("No agent registered for task: " + task.agent, "AGENT_NOT_FOUND");
    }
  }

  const existing = new Map<string, TaskSnapshot>();
  for (const task of tasks) {
    try {
      const snapshot = await runtime.getSnapshot(task);
      if (!args.replayFailed) {
        throw new TaskRuntimeError("Task already exists", "TASK_EXISTS");
      }
      if (snapshot.status === "running" || snapshot.status === "waiting") {
        throw new TaskRuntimeError("Task is already active and cannot be replayed concurrently", "TASK_ALREADY_ACTIVE");
      }
      if (snapshot.status === "cancelled") {
        throw new TaskRuntimeError("Cancelled tasks require a new execution identity", "TASK_CANCELLED");
      }
      if (snapshot.status === "failed" && (snapshot.error?.retryable !== true || task.sideEffect)) {
        throw new TaskRuntimeError("Task failure is not eligible for replay", "REPLAY_STATE_INVALID");
      }
      existing.set(task.taskId, snapshot);
    } catch (error) {
      if (error instanceof TaskRuntimeError && error.code === "TASK_NOT_FOUND") {
        await runtime.create(task);
        continue;
      }
      throw error;
    }
  }

  const executions = new Map<string, Promise<DagRunResult>>();
  const execute = (task: TaskDefinition): Promise<DagRunResult> => {
    const prior = executions.get(task.taskId);
    if (prior) return prior;

    const promise = (async (): Promise<DagRunResult> => {
      const previous = existing.get(task.taskId);
      if (previous?.status === "succeeded") {
        return { taskId: task.taskId, status: "succeeded", output: previous.output, attempts: 0 };
      }

      const dependencies = await Promise.all(
        (task.dependsOn ?? []).map(async (id) => ({
          id,
          result: await execute(tasks.find((candidate) => candidate.taskId === id)!),
        })),
      );

      if (signal?.aborted) {
        await runtime.record(task, "task.cancelled");
        return { taskId: task.taskId, status: "cancelled", attempts: 0 };
      }

      const failedDependency = dependencies.find(({ result }) => result.status !== "succeeded");
      if (failedDependency) {
        const error = {
          code: "DEPENDENCY_FAILED",
          message: "Dependency did not succeed: " + failedDependency.id,
          retryable: failedDependency.result.error?.retryable === true && !task.sideEffect,
        };
        const snapshot = existing.get(task.taskId);
        if (snapshot?.status === "failed" && args.replayFailed) {
          await runtime.record(task, "task.resumed");
          await runtime.record(task, "task.failed", undefined, error);
        } else {
          await runtime.record(task, "task.failed", undefined, error);
        }
        return { taskId: task.taskId, status: "failed", attempts: 0, error };
      }

      const agent = agentById.get(task.agent)!;
      const dependencyOutputs: Record<string, unknown> = {};
      for (const dependency of dependencies) dependencyOutputs[dependency.id] = dependency.result.output;

      let attempts = 0;
      let lastError: DagRunResult["error"];
      if (previous?.status === "failed") {
        await runtime.requestReplay(task);
        await runtime.record(task, "task.resumed");
      } else {
        await runtime.record(task, "task.started");
      }

      while (attempts < maxAttempts) {
        if (signal?.aborted) {
          await runtime.record(task, "task.cancelled");
          return { taskId: task.taskId, status: "cancelled", attempts };
        }

        attempts += 1;
        try {
          const output = await agent.execute({
            task,
            dependencyOutputs,
            signal,
            progress: async (value) => {
              if (signal?.aborted) throw new DagExecutionError("Task cancelled", "ABORTED");
              await runtime.record(task, "task.progress", value);
            },
            checkpoint: async (value) => {
              if (signal?.aborted) throw new DagExecutionError("Task cancelled", "ABORTED");
              await runtime.record(task, "task.checkpoint", value);
            },
            requireCapability: (capability) => {
              if (!agent.capabilities?.includes(capability)) {
                throw new DagExecutionError(
                  "Agent " + agent.id + " is not authorized for capability " + capability,
                  "AGENT_CAPABILITY_DENIED",
                );
              }
            },
          });
          if (signal?.aborted) {
            await runtime.record(task, "task.cancelled");
            return { taskId: task.taskId, status: "cancelled", attempts };
          }
          await runtime.record(task, "task.succeeded", output);
          return { taskId: task.taskId, status: "succeeded", output, attempts };
        } catch (cause) {
          if (signal?.aborted || (cause instanceof DagExecutionError && cause.code === "ABORTED")) {
            await runtime.record(task, "task.cancelled");
            return { taskId: task.taskId, status: "cancelled", attempts };
          }
          const transient = cause instanceof DagExecutionError && cause.retryable;
          const error = {
            code: cause instanceof DagExecutionError ? cause.code : "AGENT_EXECUTION_FAILED",
            message: cause instanceof Error ? cause.message : "Agent execution failed",
            retryable: transient && !task.sideEffect,
          };
          lastError = error;
          await runtime.record(task, "task.failed", undefined, error);
          if (!error.retryable || attempts >= maxAttempts) {
            return { taskId: task.taskId, status: "failed", attempts, error };
          }
          await runtime.requestReplay(task);
          await runtime.record(task, "task.resumed");
        }
      }

      return {
        taskId: task.taskId,
        status: "failed",
        attempts,
        error: lastError ?? { code: "RETRY_LIMIT_REACHED", message: "Task exhausted its retry budget", retryable: false },
      };
    })();

    executions.set(task.taskId, promise);
    return promise;
  };

  return Promise.all(tasks.map(execute));
}
