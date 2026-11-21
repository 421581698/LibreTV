import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EventStore } from "./event-store";
import type { TestEvent } from "./types";

const pathQueues = new Map<string, Promise<void>>();

async function withPathQueue<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = pathQueues.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  pathQueues.set(path, previous.then(() => current));
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (pathQueues.get(path) === current) pathQueues.delete(path);
  }
}

function parseLines(content: string): TestEvent[] {
  const events: TestEvent[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`Corrupt event store JSON at line ${index + 1}.`);
    }
    if (!value || typeof value !== "object") throw new Error(`Invalid event at line ${index + 1}.`);
    const event = value as TestEvent;
    if (typeof event.id !== "string" || typeof event.runId !== "string" ||
        !Number.isInteger(event.sequence) || typeof event.type !== "string" ||
        typeof event.occurredAt !== "string" || !event.payload || typeof event.payload !== "object") {
      throw new Error(`Invalid event shape at line ${index + 1}.`);
    }
    events.push(event);
  }
  return events;
}

/**
 * Durable append-only JSONL adapter for Node-based runners and CI.
 * It serializes writes within this process. Use one writer per file; this is
 * not a distributed lock and must not be shared by independent worker hosts.
 */
export class JsonlEventStore implements EventStore {
  constructor(private readonly filePath: string) {
    if (!filePath.trim()) throw new Error("An event-store file path is required.");
  }

  async append(event: TestEvent): Promise<void> {
    await withPathQueue(this.filePath, async () => {
      if (!event.id.trim() || !event.runId.trim()) throw new Error("Event id and runId are required.");
      const existing = await this.readAll();
      if (existing.some((item) => item.id === event.id)) throw new Error(`Duplicate event id: ${event.id}`);
      const runEvents = existing.filter((item) => item.runId === event.runId);
      const expected = runEvents.length + 1;
      if (event.sequence !== expected) {
        throw new Error(`Invalid event sequence for run ${event.runId}: expected ${expected}, received ${event.sequence}`);
      }
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, JSON.stringify(event) + "\n", { encoding: "utf8", flag: "a" });
    });
  }

  async listByRun(runId: string): Promise<TestEvent[]> {
    const events = await this.readAll();
    return events.filter((event) => event.runId === runId).map((event) => ({
      ...event,
      payload: { ...event.payload },
    }));
  }

  private async readAll(): Promise<TestEvent[]> {
    try {
      return parseLines(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
