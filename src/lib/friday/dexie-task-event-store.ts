import Dexie from "dexie";
import { db, type FridayTaskEventEntry } from "../db";
import type { TaskEvent, TaskEventStore } from "./task-runtime";

/**
 * Browser-local durable event store backed by the existing LibreTV Dexie database.
 * Writes are transactional and sequence numbers are unique per task.
 */
export class DexieTaskEventStore implements TaskEventStore {
  async append(event: TaskEvent): Promise<void> {
    await db.transaction("rw", db.fridayTaskEvents, async () => {
      const existingSequence = await db.fridayTaskEvents
        .where("[taskId+sequence]")
        .equals([event.taskId, event.sequence])
        .first();
      if (existingSequence) {
        throw new Error("Task event sequence already exists");
      }
      const existingId = await db.fridayTaskEvents.get(event.eventId);
      if (existingId) {
        throw new Error("Task event id already exists");
      }
      const taskEvents = await db.fridayTaskEvents
        .where("taskId")
        .equals(event.taskId)
        .toArray();
      const maxSequence = taskEvents.reduce(
        (max, item) => Math.max(max, item.sequence),
        0,
      );
      if (event.sequence !== maxSequence + 1) {
        throw new Error("Task event sequence must be contiguous");
      }
      await db.fridayTaskEvents.add(event as FridayTaskEventEntry);
    });
  }

  async read(taskId: string): Promise<TaskEvent[]> {
    const events = await db.fridayTaskEvents
      .where("taskId")
      .equals(taskId)
      .sortBy("sequence");
    return events as TaskEvent[];
  }

  async readRecent(): Promise<TaskEvent[]> {
    // Restore at most 50 newest tasks, then load each selected task's complete event stream.
    const created = await db.fridayTaskEvents
      .where("[type+occurredAt]")
      .between(["task.created", Dexie.minKey], ["task.created", Dexie.maxKey])
      .reverse()
      .limit(50)
      .toArray();
    const streams = await Promise.all(created.map((event) => this.read(event.taskId)));
    return streams.flat() as TaskEvent[];
  }

  async clearAll(): Promise<void> {
    await db.fridayTaskEvents.clear();
  }

  async deleteTask(taskId: string): Promise<void> {
    await db.transaction("rw", db.fridayTaskEvents, async () => {
      await db.fridayTaskEvents.where("taskId").equals(taskId).delete();
    });
  }
}

export const fridayTaskEventStore = new DexieTaskEventStore();
