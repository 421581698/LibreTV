import "fake-indexeddb/auto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, exportConfig, favoriteId, importConfig, PERSIST_KEY, readSpatialState, writeSpatialState } from "../db";
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
  await db.open();
});

beforeEach(async () => {
  await db.fridayTaskEvents.clear();
  await db.spatialState.clear();
  await db.favorites.clear();
  await db.history.clear();
  await db.progress.clear();
});

afterAll(async () => {
  db.close();
  vi.unstubAllGlobals();
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

  it("rejects oversized task payloads before writing to IndexedDB", async () => {
    await expect(store.append(event({ payload: { prompt: "x".repeat(300 * 1024) } })))
      .rejects.toThrow("Task event exceeds the 256 KiB persistence limit");
    expect(await db.fridayTaskEvents.count()).toBe(0);
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

  it("prunes only old terminal tasks and preserves active and recent tasks", async () => {
    const old = "2025-01-01T00:00:00.000Z";
    const recent = "2026-11-09T00:00:00.000Z";
    await store.append(event({ eventId: "old-created", taskId: "old-done", occurredAt: old }));
    await store.append(event({
      eventId: "old-failed", taskId: "old-done", sequence: 2,
      type: "task.failed", occurredAt: old,
      error: { code: "FAILED", message: "done", retryable: false },
    }));
    await store.append(event({ eventId: "active-created", taskId: "old-active", occurredAt: old }));
    await store.append(event({
      eventId: "active-started", taskId: "old-active", sequence: 2,
      type: "task.started", occurredAt: old,
    }));
    await store.append(event({ eventId: "recent-created", taskId: "recent-done", occurredAt: recent }));
    await store.append(event({
      eventId: "recent-succeeded", taskId: "recent-done", sequence: 2,
      type: "task.succeeded", occurredAt: recent,
    }));

    const removed = await store.pruneTerminalTasks("2026-01-01T00:00:00.000Z", 1);
    expect(removed).toEqual(["old-done"]);
    expect(await store.read("old-done")).toEqual([]);
    expect(await store.read("old-active")).toHaveLength(2);
    expect(await store.read("recent-done")).toHaveLength(2);
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

describe("portable profile import/export with IndexedDB", () => {
  const localValues = new Map<string, string>();

  beforeEach(() => {
    localValues.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => { localValues.set(key, String(value)); },
      removeItem: (key: string) => { localValues.delete(key); },
    });
  });

  it("round-trips favorites, spatial preferences, viewing history, progress and settings", async () => {
    const profile = {
      name: "LibreTV-Settings",
      time: "1794182400000",
      cfgVer: "3.0.0",
      data: {
        [PERSIST_KEY]: JSON.stringify({ state: { theme: "dark" }, version: 1 }),
        favorites: JSON.stringify([{
          id: favoriteId("fmhy-resource", "https://fmhy.net/"),
          kind: "fmhy-resource",
          title: "FMHY",
          href: "https://fmhy.net/",
          createdAt: 100,
          updatedAt: 100,
        }]),
        spatialState: JSON.stringify([{ key: "active-space", value: "resources", updatedAt: 100 }]),
        viewingHistory: JSON.stringify([{
          sourceKey: "source-a",
          vodId: "movie-1",
          title: "Test Movie",
          episodeIndex: 2,
          totalEpisodes: 8,
          playbackPosition: 120,
          duration: 3600,
          timestamp: 100,
        }]),
        playbackProgress: JSON.stringify([{
          key: "source-a_movie-1_2",
          position: 120,
          duration: 3600,
          updatedAt: 100,
        }]),
      },
    };

    await importConfig(JSON.stringify(profile));
    expect(await db.favorites.count()).toBe(1);
    expect(await readSpatialState("active-space")).toBe("resources");
    expect(await db.history.get("source-a_movie-1")).toMatchObject({
      title: "Test Movie",
      episodeIndex: 2,
      totalEpisodes: 8,
    });
    expect(await db.progress.get("source-a_movie-1_2")).toMatchObject({
      position: 120,
      duration: 3600,
    });
    expect(localValues.get(PERSIST_KEY)).toBe(profile.data[PERSIST_KEY]);

    const exported = JSON.parse(await exportConfig());
    expect(exported.name).toBe("LibreTV-Settings");
    expect(JSON.parse(exported.data.favorites)).toHaveLength(1);
    expect(JSON.parse(exported.data.spatialState)).toHaveLength(1);
    expect(JSON.parse(exported.data.viewingHistory)).toHaveLength(1);
    expect(JSON.parse(exported.data.playbackProgress)).toHaveLength(1);
    expect(exported.data).not.toHaveProperty("fridayTaskEvents");
    expect(exported.data).not.toHaveProperty("conversationHistory");
  });

  it("validates all JSON sections before changing any IndexedDB or localStorage data", async () => {
    const invalid = {
      name: "LibreTV-Settings",
      data: {
        [PERSIST_KEY]: "new-settings",
        favorites: JSON.stringify([{
          id: "fmhy-resource:one",
          kind: "fmhy-resource",
          title: "One",
          createdAt: 1,
          updatedAt: 1,
        }]),
        spatialState: "{not-json",
      },
    };

    await expect(importConfig(JSON.stringify(invalid))).rejects.toThrow();
    expect(await db.favorites.count()).toBe(0);
    expect(await db.spatialState.count()).toBe(0);
    expect(localValues.has(PERSIST_KEY)).toBe(false);
  });

  it("filters unsafe favorite URLs while importing valid records", async () => {
    const profile = {
      name: "LibreTV-Settings",
      data: {
        favorites: JSON.stringify([
          { id: "safe", kind: "media", title: "Safe", href: "https://example.com/a" },
          { id: "unsafe", kind: "media", title: "Unsafe", href: "javascript:alert(1)" },
        ]),
      },
    };
    await importConfig(JSON.stringify(profile));
    expect(await db.favorites.toArray()).toMatchObject([
      { id: "safe", href: "https://example.com/a" },
    ]);
  });
});
