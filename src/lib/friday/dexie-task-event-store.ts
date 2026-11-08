import Dexie from "dexie";
import { db, type FridayTaskEventEntry } from "../db";
import type { TaskEvent, TaskEventStore } from "./task-runtime";

export const MAX_TASK_EVENT_BYTES = 256 * 1024;

export type TaskAuditSummary = {
  taskId: string;
  agent: string;
  status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  sideEffect: boolean;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
  errorCode?: string;
};

/**
 * Browser-local durable event store backed by the existing LibreTV Dexie database.
 * Writes are transactional and sequence numbers are unique per task.
 */
export class DexieTaskEventStore implements TaskEventStore {
  async append(event: TaskEvent): Promise<void> {
    let serialized: string;
    try {
      serialized = JSON.stringify(event);
    } catch {
      throw new Error("Task event must be JSON-serializable");
    }
    if (new TextEncoder().encode(serialized).byteLength > MAX_TASK_EVENT_BYTES) {
      throw new Error("Task event exceeds the 256 KiB persistence limit");
    }
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

  /** Read-only, payload-redacted summaries for the Intelligence workspace. */
  async listRecentTaskAudit(): Promise<TaskAuditSummary[]> {
    const events = await this.readRecent();
    const grouped = new Map<string, TaskEvent[]>();
    for (const event of events) {
      const stream = grouped.get(event.taskId) ?? [];
      stream.push(event);
      grouped.set(event.taskId, stream);
    }

    const summaries: TaskAuditSummary[] = [];
    for (const [taskId, stream] of grouped) {
      const ordered = [...stream].sort((a, b) => a.sequence - b.sequence);
      const created = ordered.find((event) => event.type === "task.created");
      if (!created) continue;
      const definition = (created.payload as {
        definition?: { agent?: string; sideEffect?: boolean };
      } | undefined)?.definition;
      let status: TaskAuditSummary["status"] = "queued";
      for (const event of ordered) {
        switch (event.type) {
          case "task.started":
          case "task.resumed": status = "running"; break;
          case "task.waiting": status = "waiting"; break;
          case "task.succeeded": status = "succeeded"; break;
          case "task.failed": status = "failed"; break;
          case "task.cancelled": status = "cancelled"; break;
          default: break;
        }
      }
      const last = ordered[ordered.length - 1];
      const errorCode = last?.type === "task.failed" ? last.error?.code : undefined;
      summaries.push({
        taskId,
        agent: typeof definition?.agent === "string" ? definition.agent : "unknown",
        status,
        sideEffect: Boolean(definition?.sideEffect),
        eventCount: ordered.length,
        createdAt: created.occurredAt,
        updatedAt: last?.occurredAt ?? created.occurredAt,
        ...(errorCode ? { errorCode } : {}),
      });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Explicit maintenance only: remove old terminal task streams while retaining
   * active tasks and the newest task records for diagnostics.
   */
  async pruneTerminalTasks(olderThan: string, keepRecentTaskCount = 50): Promise<string[]> {
    const cutoff = Date.parse(olderThan);
    if (!Number.isFinite(cutoff)) throw new Error("Invalid task retention cutoff");
    const keepCount = Math.max(0, Math.floor(keepRecentTaskCount));
    const recentCreated = await db.fridayTaskEvents
      .where("[type+occurredAt]")
      .between(["task.created", Dexie.minKey], ["task.created", Dexie.maxKey])
      .reverse()
      .limit(keepCount)
      .toArray();
    const protectedTaskIds = new Set(recentCreated.map((event) => event.taskId));
    const terminalTypes = new Set(["task.succeeded", "task.failed", "task.cancelled"]);
    const terminalEvents = await db.fridayTaskEvents
      .where("occurredAt")
      .below(olderThan)
      .toArray();
    const candidateIds = [...new Set(terminalEvents.map((event) => event.taskId))]
      .filter((taskId) => !protectedTaskIds.has(taskId));
    const removed: string[] = [];
    for (const taskId of candidateIds) {
      const stream = await this.read(taskId);
      const last = stream[stream.length - 1];
      if (last && terminalTypes.has(last.type) && Date.parse(last.occurredAt) < cutoff) {
        await this.deleteTask(taskId);
        removed.push(taskId);
      }
    }
    return removed;
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
