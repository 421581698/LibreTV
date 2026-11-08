import { runFridayDag, type DagRunResult } from "./dag-orchestrator";
import { createMovieAgentRegistry, type MovieAgentAdapters } from "./movie-agents";
import type { TaskRuntime } from "./task-runtime";

export type MovieWorkflowResult = {
  taskIds: {
    search: string;
    source: string;
    quality: string;
    review: string;
    playback: string;
  };
  results: DagRunResult[];
};

/**
 * Generates a per-request namespace. UUID entropy prevents two searches started
 * in the same millisecond (or across tabs) from sharing persisted task IDs.
 */
export function createMovieWorkflowTaskIdPrefix(
  now = Date.now(),
  uniqueId = globalThis.crypto.randomUUID(),
): string {
  return `friday-${now}-${uniqueId}`;
}

/**
 * Runs the movie discovery and source-evidence workflow through the durable
 * TaskRuntime. Callers provide a unique prefix per user request so persisted
 * task IDs cannot collide with earlier runs.
 */
export async function runLibreTVMovieWorkflow(args: {
  query: string;
  taskIdPrefix: string;
  adapters: MovieAgentAdapters;
  runtime: TaskRuntime;
  signal?: AbortSignal;
  replayFailed?: boolean;
  parentTaskId?: string;
}): Promise<MovieWorkflowResult> {
  const prefix = args.taskIdPrefix.trim();
  const query = args.query.trim();
  if (!prefix) throw new Error("Movie workflow requires a task ID prefix");
  if (!query) throw new Error("Movie workflow requires a non-empty query");

  const taskIds = {
    search: `${prefix}.search`,
    source: `${prefix}.source`,
    quality: `${prefix}.quality`,
    review: `${prefix}.review`,
    playback: `${prefix}.playback`,
  };

  const tasks = [
    { taskId: taskIds.search, parentTaskId: args.parentTaskId, agent: "search-agent", input: { query } },
    {
      taskId: taskIds.source,
      parentTaskId: taskIds.search,
      agent: "source-agent",
      input: { searchTaskId: taskIds.search },
      dependsOn: [taskIds.search],
    },
    {
      taskId: taskIds.quality,
      parentTaskId: taskIds.source,
      agent: "quality-agent",
      input: { sourceTaskId: taskIds.source },
      dependsOn: [taskIds.source],
    },
    {
      taskId: taskIds.review,
      parentTaskId: taskIds.quality,
      agent: "review-agent",
      input: { searchTaskId: taskIds.search, qualityTaskId: taskIds.quality },
      dependsOn: [taskIds.search, taskIds.quality],
    },
    {
      taskId: taskIds.playback,
      parentTaskId: taskIds.review,
      agent: "playback-agent",
      input: {
        searchTaskId: taskIds.search,
        qualityTaskId: taskIds.quality,
        reviewTaskId: taskIds.review,
      },
      dependsOn: [taskIds.search, taskIds.quality, taskIds.review],
    },
  ];

  const results = await runFridayDag({
    tasks,
    agents: createMovieAgentRegistry(args.adapters),
    runtime: args.runtime,
    signal: args.signal,
    replayFailed: args.replayFailed,
  });

  return { taskIds, results };
}
