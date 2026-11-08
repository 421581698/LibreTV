export type TaskStatus = "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
export type TaskEventType =
  | "task.created"
  | "task.started"
  | "task.progress"
  | "task.checkpoint"
  | "task.waiting"
  | "task.resumed"
  | "task.succeeded"
  | "task.failed"
  | "task.cancelled"
  | "task.replay_requested";
export type TaskEvent = {
  eventId: string;
  taskId: string;
  parentTaskId?: string;
  sequence: number;
  type: TaskEventType;
  occurredAt: string;
  agent?: string;
  payload?: unknown;
  error?: { code: string; message: string; retryable: boolean };
};
export type TaskDefinition = {
  taskId: string;
  parentTaskId?: string;
  agent: string;
  input: unknown;
  dependsOn?: string[];
  sideEffect?: boolean;
};
export type TaskSnapshot = {
  taskId: string;
  parentTaskId?: string;
  agent: string;
  status: TaskStatus;
  input: unknown;
  output?: unknown;
  dependsOn: string[];
  sideEffect: boolean;
  checkpoint?: unknown;
  lastSequence: number;
  error?: { code: string; message: string; retryable: boolean };
};
export interface TaskEventStore {
  append(event: TaskEvent): Promise<void>;
  read(taskId: string): Promise<TaskEvent[]>;
  readRecent?(): Promise<TaskEvent[]>;
  readAll?(): Promise<TaskEvent[]>;
}
export class TaskRuntimeError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "TaskRuntimeError";
  }
}
const TERMINAL = new Set<TaskStatus>(["succeeded", "cancelled"]);
function assertSafeId(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    throw new TaskRuntimeError("Invalid " + label, "INVALID_ID");
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableSerialize).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) =>
      JSON.stringify(key) + ":" + stableSerialize(record[key]),
    ).join(",") + "}";
  }
  return JSON.stringify(value) ?? "undefined";
}

function validateEventStream(taskId: string, events: TaskEvent[]): TaskEvent[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const eventIds = new Set<string>();
  ordered.forEach((event, index) => {
    if (event.taskId !== taskId || event.sequence !== index + 1 || !event.eventId || eventIds.has(event.eventId)) {
      throw new TaskRuntimeError("Task event stream is inconsistent", "EVENT_STREAM_CORRUPT");
    }
    eventIds.add(event.eventId);
  });
  return ordered;
}

function assertTaskDefinitionMatches(definition: TaskDefinition, events: TaskEvent[]): void {
  const created = events.find((event) => event.type === "task.created");
  const persisted = (created?.payload as { definition?: TaskDefinition } | undefined)?.definition;
  if (!persisted) throw new TaskRuntimeError("Persisted task definition is missing", "TASK_DEFINITION_MISSING");
  const normalize = (task: TaskDefinition) => ({
    taskId: task.taskId,
    parentTaskId: task.parentTaskId ?? null,
    agent: task.agent,
    input: task.input,
    dependsOn: task.dependsOn ?? [],
    sideEffect: Boolean(task.sideEffect),
  });
  if (stableSerialize(normalize(definition)) !== stableSerialize(normalize(persisted))) {
    throw new TaskRuntimeError("Task ID is already bound to a different definition", "TASK_DEFINITION_MISMATCH");
  }
}
export function validateTaskGraph(definitions: TaskDefinition[]): void {
  const byId = new Map<string, TaskDefinition>();
  for (const task of definitions) {
    assertSafeId(task.taskId, "task id");
    assertSafeId(task.agent, "agent id");
    if (byId.has(task.taskId)) throw new TaskRuntimeError("Duplicate task id", "DUPLICATE_TASK");
    byId.set(task.taskId, task);
  }
  for (const task of definitions) {
    for (const dependency of task.dependsOn ?? []) {
      if (!byId.has(dependency)) throw new TaskRuntimeError("Unknown dependency: " + dependency, "UNKNOWN_DEPENDENCY");
      if (dependency === task.taskId) throw new TaskRuntimeError("Task cannot depend on itself", "TASK_CYCLE");
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new TaskRuntimeError("Task graph contains a cycle", "TASK_CYCLE");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}
export function reduceTaskEvents(definition: TaskDefinition, events: TaskEvent[]): TaskSnapshot {
  const state: TaskSnapshot = {
    taskId: definition.taskId,
    parentTaskId: definition.parentTaskId,
    agent: definition.agent,
    status: "queued",
    input: definition.input,
    dependsOn: definition.dependsOn ?? [],
    sideEffect: Boolean(definition.sideEffect),
    lastSequence: 0,
  };
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.taskId !== definition.taskId || event.sequence <= state.lastSequence) continue;
    state.lastSequence = event.sequence;
    switch (event.type) {
      case "task.created": state.status = "queued"; break;
      case "task.started":
      case "task.resumed": state.status = "running"; state.error = undefined; break;
      case "task.progress": break;
      case "task.checkpoint": state.checkpoint = event.payload; break;
      case "task.waiting": state.status = "waiting"; break;
      case "task.succeeded": state.status = "succeeded"; state.output = event.payload; state.error = undefined; break;
      case "task.failed": state.status = "failed"; state.error = event.error; break;
      case "task.cancelled": state.status = "cancelled"; break;
      case "task.replay_requested": break;
    }
  }
  return state;
}
export class TaskRuntime {
  constructor(
    private readonly store: TaskEventStore,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = () => "evt-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
  ) {}

  private async readValidatedEvents(taskId: string): Promise<TaskEvent[]> {
    const events = await this.store.read(taskId);
    if (!events.length) return [];
    return validateEventStream(taskId, events);
  }

  async getSnapshot(definition: TaskDefinition): Promise<TaskSnapshot> {
    const events = await this.readValidatedEvents(definition.taskId);
    if (!events.length) throw new TaskRuntimeError("Task does not exist", "TASK_NOT_FOUND");
    assertTaskDefinitionMatches(definition, events);
    return reduceTaskEvents(definition, events);
  }

  async create(definition: TaskDefinition): Promise<TaskSnapshot> {
    assertSafeId(definition.taskId, "task id");
    assertSafeId(definition.agent, "agent id");
    if ((await this.store.read(definition.taskId)).length) {
      throw new TaskRuntimeError("Task already exists", "TASK_EXISTS");
    }
    const event: TaskEvent = {
      eventId: this.createId(),
      taskId: definition.taskId,
      parentTaskId: definition.parentTaskId,
      sequence: 1,
      type: "task.created",
      occurredAt: this.now(),
      agent: definition.agent,
      payload: { definition },
    };
    await this.store.append(event);
    return reduceTaskEvents(definition, [event]);
  }

  async record(
    definition: TaskDefinition,
    type: Exclude<TaskEventType, "task.created" | "task.replay_requested">,
    payload?: unknown,
    error?: TaskEvent["error"],
  ): Promise<TaskSnapshot> {
    const events = await this.readValidatedEvents(definition.taskId);
    if (!events.length) throw new TaskRuntimeError("Task does not exist", "TASK_NOT_FOUND");
    assertTaskDefinitionMatches(definition, events);
    const current = reduceTaskEvents(definition, events);
    if (TERMINAL.has(current.status)) throw new TaskRuntimeError("Terminal task cannot be changed", "TASK_TERMINAL");
    const allowed: Record<Exclude<TaskEventType, "task.created" | "task.replay_requested">, TaskStatus[]> = {
      "task.started": ["queued"],
      "task.progress": ["running"],
      "task.checkpoint": ["running"],
      "task.waiting": ["running"],
      "task.resumed": ["waiting", "failed"],
      "task.succeeded": ["running"],
      "task.failed": ["queued", "running", "waiting"],
      "task.cancelled": ["queued", "running", "waiting"],
    };
    if (!allowed[type].includes(current.status)) {
      throw new TaskRuntimeError("Invalid transition: " + current.status + " -> " + type, "INVALID_TRANSITION");
    }
    const event: TaskEvent = {
      eventId: this.createId(),
      taskId: definition.taskId,
      parentTaskId: definition.parentTaskId,
      sequence: current.lastSequence + 1,
      type,
      occurredAt: this.now(),
      agent: definition.agent,
      ...(payload === undefined ? {} : { payload }),
      ...(error ? { error } : {}),
    };
    await this.store.append(event);
    return reduceTaskEvents(definition, [...events, event]);
  }

  async requestReplay(definition: TaskDefinition): Promise<TaskEvent> {
    const events = await this.readValidatedEvents(definition.taskId);
    if (!events.length) throw new TaskRuntimeError("Task does not exist", "TASK_NOT_FOUND");
    assertTaskDefinitionMatches(definition, events);
    const current = reduceTaskEvents(definition, events);
    if (definition.sideEffect) {
      throw new TaskRuntimeError("Side-effect tasks require an explicit new execution; automatic replay is blocked", "REPLAY_SIDE_EFFECT_BLOCKED");
    }
    if (current.status !== "failed" || current.error?.retryable !== true) {
      throw new TaskRuntimeError("Only retryable failed tasks can request replay", "REPLAY_STATE_INVALID");
    }
    const replayCount = events.filter((event) => event.type === "task.replay_requested").length;
    if (replayCount >= 4) {
      throw new TaskRuntimeError("Task reached its manual replay limit", "REPLAY_LIMIT_REACHED");
    }
    const event: TaskEvent = {
      eventId: this.createId(),
      taskId: definition.taskId,
      parentTaskId: definition.parentTaskId,
      sequence: current.lastSequence + 1,
      type: "task.replay_requested",
      occurredAt: this.now(),
      agent: definition.agent,
      payload: {
        attempt: events.filter((event) => event.type === "task.replay_requested").length + 2,
        fromSequence: current.lastSequence,
        checkpoint: current.checkpoint,
      },
    };
    await this.store.append(event);
    return event;
  }

  /**
   * Restores recent task history and reconciles orphaned running/waiting tasks.
   * A browser reload cannot safely resume network or other side effects. Such
   * tasks are therefore closed as interrupted failures, exactly once.
   */
  async restoreAll(): Promise<TaskSnapshot[]> {
    const readEvents = this.store.readRecent ?? this.store.readAll;
    if (!readEvents) return [];
    const events = await readEvents.call(this.store);
    const grouped = new Map<string, TaskEvent[]>();
    for (const event of events) {
      const list = grouped.get(event.taskId) ?? [];
      list.push(event);
      grouped.set(event.taskId, list);
    }

    const snapshots: TaskSnapshot[] = [];
    for (const taskEvents of grouped.values()) {
      const orderedEvents = validateEventStream(taskEvents[0]?.taskId ?? "", taskEvents);
      const created = orderedEvents.find((event) => event.type === "task.created");
      const definition = (created?.payload as { definition?: TaskDefinition } | undefined)?.definition;
      if (!definition || definition.taskId !== created?.taskId || typeof definition.agent !== "string") continue;

      let snapshot = reduceTaskEvents(definition, orderedEvents);
      if (snapshot.status === "running" || snapshot.status === "waiting") {
        try {
          snapshot = await this.record(definition, "task.failed", undefined, {
            code: "TASK_INTERRUPTED",
            message: "Task was interrupted by a page reload or runtime shutdown; it was not automatically resumed.",
            retryable: false,
          });
        } catch (error) {
          // Another tab may reconcile the same task between our read and append.
          // Accept the winner's terminal/current snapshot, but never hide an
          // unrelated storage failure while the task is still orphaned.
          const latestEvents = await this.readValidatedEvents(definition.taskId);
          assertTaskDefinitionMatches(definition, latestEvents);
          const latest = reduceTaskEvents(definition, latestEvents);
          if (latest.status === "running" || latest.status === "waiting") throw error;
          snapshot = latest;
        }
      }
      snapshots.push(snapshot);
    }

    return snapshots.sort((a, b) => {
      const createdAt = (taskId: string) =>
        grouped.get(taskId)?.find((event) => event.type === "task.created")?.occurredAt ?? "";
      return createdAt(b.taskId).localeCompare(createdAt(a.taskId));
    });
  }
}
