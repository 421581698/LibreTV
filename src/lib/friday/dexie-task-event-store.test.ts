import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, readSpatialState, writeSpatialState } from "../db";
import { DexieTaskEventStore } from "./dexie-task-event-store";
import { TaskRuntime, type TaskDefinition, type TaskEvent } from "./task-runtime";

const store = new DexieTaskEventStore();

function event(overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    eventId: "event-1",
    taskId: "task-1",
    sequence: 1,
    type: "task.created",
    occurredAt: "2026-11-09T00:00:00.000Z",
    ...overrides,
  };
}

beforeAll(async () => {
  if (typeof indexedDB === "undefined") {
    throw new Error("This suite requires Node 24's native IndexedDB implementation.");
  }
  await db.open();
});

beforeEach(async () => {
  await db.fridayTaskEvents.clear();
  await db.spatialState.clear();
});

afterAll(async () => {
  db.close();
});

describe("DexieTaskEventStore with native IndexedDB", () => {
  it("persists and reads a complete task stream in sequence order", async () => {
    await store.append(event());
    await store.append(event({
      eventId: "event-2",
      sequence: 2,
      type: "task.started",
      occurredAt: "2026-11-09T00:00:01.000Z",
    }));
    await store.append(event({
      eventId: "event-3",
      sequence: 3,
      type: "task.succeeded",
      occurredAt: "2026-11-09T00:00:02.000Z",
      payload: { count: 2 },
    }));

    expect(await store.read("task-1")).toMatchObject([
      { eventId: "event-1", sequence: 1 },
      { eventId: "event-2", sequence: 2 },
      { eventId: "event-3", sequence: 3, payload: { count: 2 } },
    ]);
  });

  it("rejects a duplicate event ID without changing the existing stream", async () => {
    await store.append(event());
    await expect(store.append(event({
      eventId: "event-1",
      taskId: "task-2",
    }))).rejects.toBeDefined();

    expect(await store.read("task-1")).toHaveLength(1);
    expect(await store.read("task-2")).toHaveLength(0);
  });

  it("rejects duplicate and non-contiguous task sequence numbers", async () => {
    await store.append(event());
    await expect(store.append(event({
      eventId: "event-2",
      sequence: 1,
    }))).rejects.toThrow("Task event sequence already exists");
    await expect(store.append(event({
      eventId: "event-3",
      sequence: 3,
    }))).rejects.toThrow("Task event sequence must be contiguous");
    expect(await store.read("task-1")).toHaveLength(1);
  });

  it("serializes concurrent appends for the same next sequence", async () => {
    await store.append(event());
    const attempts = await Promise.allSettled([
      store.append(event({ eventId: "concurrent-a", sequence: 2 })),
      store.append(event({ eventId: "concurrent-b", sequence: 2 })),
    ]);

    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await store.read("task-1")).toHaveLength(2);
    expect((await store.read("task-1")).map((item) => item.sequence)).toEqual([1, 2]);
  });

  it("returns complete streams for only the 50 most recently created tasks", async () => {
    for (let index = 0; index < 51; index += 1) {
      const taskId = `recent-${index.toString().padStart(2, "0")}`;
      const occurredAt = new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString();
      await store.append(event({
        eventId: `${taskId}-created`,
        taskId,
        occurredAt,
      }));
      await store.append(event({
        eventId: `${taskId}-started`,
        taskId,
        sequence: 2,
        type: "task.started",
        occurredAt,
      }));
    }

    const recent = await store.readRecent();
    const taskIds = new Set(recent.map((item) => item.taskId));
    expect(taskIds.size).toBe(50);
    expect(taskIds.has("recent-00")).toBe(false);
    expect(taskIds.has("recent-50")).toBe(true);
    expect(recent).toHaveLength(100);
  });

  it("deletes one task transactionally and supports explicit full clearing", async () => {
    await store.append(event());
    await store.append(event({ eventId: "other-created", taskId: "other-task" }));
    await store.deleteTask("task-1");
    expect(await store.read("task-1")).toEqual([]);
    expect(await store.read("other-task")).toHaveLength(1);

    await store.clearAll();
    expect(await db.fridayTaskEvents.count()).toBe(0);
  });

  it("reconciles an interrupted task after reopening the runtime without replaying side effects", async () => {
    const definition: TaskDefinition = {
      taskId: "interrupted-player-task",
      agent: "playback-agent",
      input: { action: "play" },
      sideEffect: true,
    };
    const firstRuntime = new TaskRuntime(store);
    await firstRuntime.create(definition);
    await firstRuntime.record(definition, "task.started");

    const restored = await new TaskRuntime(store).restoreAll();
    expect(restored).toMatchObject([{
      taskId: definition.taskId,
      status: "failed",
      sideEffect: true,
      error: { code: "TASK_INTERRUPTED", retryable: false },
    }]);
    await expect(new TaskRuntime(store).requestReplay(definition))
      .rejects.toMatchObject({ code: "REPLAY_SIDE_EFFECT_BLOCKED" });
    expect((await store.read(definition.taskId)).map((item) => item.type))
      .toEqual(["task.created", "task.started", "task.failed"]);
  });
});

describe("spatial preference persistence with native IndexedDB", () => {
  it("round-trips a spatial preference and overwrites its existing key", async () => {
    await writeSpatialState("active-space", "intelligence");
    expect(await readSpatialState("active-space")).toBe("intelligence");

    await writeSpatialState("active-space", "resources");
    expect(await readSpatialState("active-space")).toBe("resources");
    expect(await db.spatialState.count()).toBe(1);
  });

  it("returns undefined for an unknown spatial preference key", async () => {
    await expect(readSpatialState("not-present")).resolves.toBeUndefined();
  });
});
