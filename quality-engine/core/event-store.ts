import type { TestEvent } from "./types";

export interface EventStore {
  append(event: TestEvent): Promise<void>;
  listByRun(runId: string): Promise<TestEvent[]>;
}

export class InMemoryEventStore implements EventStore {
  private readonly events = new Map<string, TestEvent[]>();
  private readonly ids = new Set<string>();

  async append(event: TestEvent): Promise<void> {
    if (!event.id.trim() || !event.runId.trim()) throw new Error("Event id and runId are required.");
    if (this.ids.has(event.id)) throw new Error(`Duplicate event id: ${event.id}`);
    const stream = this.events.get(event.runId) ?? [];
    const expected = stream.length + 1;
    if (event.sequence !== expected) {
      throw new Error(`Invalid event sequence for run ${event.runId}: expected ${expected}, received ${event.sequence}`);
    }
    stream.push({ ...event, payload: { ...event.payload } });
    this.events.set(event.runId, stream);
    this.ids.add(event.id);
  }

  async listByRun(runId: string): Promise<TestEvent[]> {
    return (this.events.get(runId) ?? []).map((event) => ({
      ...event,
      payload: { ...event.payload },
    }));
  }
}

export function withSequence(event: TestEvent, sequence: number): TestEvent {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error("Event sequence must be a positive integer.");
  return { ...event, sequence };
}
