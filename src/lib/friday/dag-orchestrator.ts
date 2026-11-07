import {
  TaskRuntime,
  validateTaskGraph,
  type TaskDefinition,
} from "./task-runtime";

export type AgentExecutionContext = {
  task: TaskDefinition;
  dependencyOutputs: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
  progress(value: unknown): Promise<void>;
  checkpoint(value: unknown): Promise<void>;
};

export type FridayAgent = {
  id: string;
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
 * retried. Side-effect tasks are never automatically replayed.
 */
export async function runFridayDag(args: {
  tasks: TaskDefinition[];
  agents: FridayAgent[];
  runtime: TaskRuntime;
  signal?: AbortSignal;
  maxAttempts?: number;
}): Promise<DagRunResult[]> {
  const { tasks, agents, runtime, signal } = args;
  const maxAttempts = Math.max(1, Math.min(3, Math.floor(args.maxAttempts ?? 2)));
  validateTaskGraph(tasks);

  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  for (const task of tasks) {
    if (!agentById.has(task.agent)) {
      throw new DagExecutionError("No agent registered for task: " + task.agent, "AGENT_NOT_FOUND");
    }
  }

  for (const task of tasks) await runtime.create(task);

  const executions = new Map<string, Promise<DagRunResult>>();
  const execute = (task: TaskDefinition): Promise<DagRunResult> => {
    const existing = executions.get(task.taskId);
    if (existing) return existing;

    const promise = (async (): Promise<DagRunResult> => {
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
          retryable: false,
        };
        await runtime.record(task, "task.failed", undefined, error);
        return { taskId: task.taskId, status: "failed", attempts: 0, error };
      }

      const agent = agentById.get(task.agent)!;
      const dependencyOutputs: Record<string, unknown> = {};
      for (const dependency of dependencies) dependencyOutputs[dependency.id] = dependency.result.output;

      let attempts = 0;
      while (attempts < maxAttempts) {
        if (signal?.aborted) {
          await runtime.record(task, "task.cancelled");
          return { taskId: task.taskId, status: "cancelled", attempts };
        }

        attempts += 1;
        if (attempts === 1) {
          await runtime.record(task, "task.started");
        } else {
          await runtime.requestReplay(task);
          await runtime.record(task, "task.resumed");
        }

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
          const retryable = cause instanceof DagExecutionError && cause.retryable;
          const error = {
            code: cause instanceof DagExecutionError ? cause.code : "AGENT_EXECUTION_FAILED",
            message: cause instanceof Error ? cause.message : "Agent execution failed",
            retryable: retryable && !task.sideEffect && attempts < maxAttempts,
          };
          await runtime.record(task, "task.failed", undefined, error);
          if (!error.retryable) return { taskId: task.taskId, status: "failed", attempts, error };
        }
      }

      const error = {
        code: "RETRY_LIMIT_REACHED",
        message: "Task exhausted its retry budget",
        retryable: false,
      };
      return { taskId: task.taskId, status: "failed", attempts, error };
    })();

    executions.set(task.taskId, promise);
    return promise;
  };

  return Promise.all(tasks.map(execute));
}
