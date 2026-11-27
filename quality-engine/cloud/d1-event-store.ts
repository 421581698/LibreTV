import type { EventStore } from "../core/event-store";
import type { TestEvent } from "../core/types";

export interface D1Result<T> {
  results: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface EventRow {
  id: string;
  run_id: string;
  sequence: number;
  type: TestEvent["type"];
  occurred_at: string;
  payload_json: string;
}

/**
 * Durable Cloudflare D1 event store.
 *
 * D1's UNIQUE(run_id, sequence) and PRIMARY KEY(id) constraints are the
 * cross-request concurrency guard. A racing append may lose with a conflict,
 * but cannot silently fork or overwrite an event stream.
 */
export class D1EventStore implements EventStore {
  constructor(private readonly db: D1Database) {}

  async append(event: TestEvent): Promise<void> {
    if (!event.id?.trim() || !event.runId?.trim()) {
      throw new Error("Event id and runId are required.");
    }
    if (!Number.isInteger(event.sequence) || event.sequence < 1) {
      throw new Error("Event sequence must be a positive integer.");
    }
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      throw new Error("Event payload must be an object.");
    }

    const latest = await this.db
      .prepare("SELECT MAX(sequence) AS max_sequence FROM quality_events WHERE run_id = ?")
      .bind(event.runId)
      .first<{ max_sequence: number | null }>();
    const expected = (latest?.max_sequence ?? 0) + 1;
    if (event.sequence !== expected) {
      throw new Error(`Invalid event sequence for run ${event.runId}: expected ${expected}, received ${event.sequence}`);
    }

    try {
      const result = await this.db
        .prepare(
          "INSERT INTO quality_events (id, run_id, sequence, type, occurred_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          event.id,
          event.runId,
          event.sequence,
          event.type,
          event.occurredAt,
          JSON.stringify(event.payload),
        )
        .run();
      if (!result.success) throw new Error("D1 rejected the event append.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/unique|constraint/i.test(message)) {
        throw new Error("Event append conflict: duplicate event id or run sequence.");
      }
      throw error;
    }
  }

  async listByRun(runId: string): Promise<TestEvent[]> {
    const result = await this.db
      .prepare(
        "SELECT id, run_id, sequence, type, occurred_at, payload_json FROM quality_events WHERE run_id = ? ORDER BY sequence ASC",
      )
      .bind(runId)
      .all<EventRow>();

    return result.results.map((row) => ({
      id: row.id,
      runId: row.run_id,
      sequence: row.sequence,
      type: row.type,
      occurredAt: row.occurred_at,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    }));
  }
}
