import { describe, expect, it } from "vitest";
import { D1EventStore, type D1Database, type D1PreparedStatement } from "../quality-engine/cloud/d1-event-store";
import type { TestEvent } from "../quality-engine/core/types";

type Row = { id: string; run_id: string; sequence: number; type: TestEvent["type"]; occurred_at: string; payload_json: string };

class FakeD1 implements D1Database {
  readonly rows: Row[] = [];

  prepare(query: string): D1PreparedStatement {
    let values: unknown[] = [];
    const statement = {
      bind: (...next: unknown[]) => { values = next; return statement; },
      first: async <T,>() => {
        if (query.includes("MAX(sequence)")) {
          const runId = String(values[0]);
          const max = this.rows.filter((row) => row.run_id === runId).reduce((value, row) => Math.max(value, row.sequence), 0);
          return { max_sequence: max || null } as T;
        }
        return null;
      },
      all: async <T,>() => {
        const runId = String(values[0]);
        return { results: this.rows.filter((row) => row.run_id === runId).sort((a, b) => a.sequence - b.sequence) as T[] };
      },
      run: async () => {
        const [id, runId, sequence, type, occurredAt, payload] = values;
        if (this.rows.some((row) => row.id === id || (row.run_id === runId && row.sequence === sequence))) {
          throw new Error("UNIQUE constraint failed");
        }
        this.rows.push({
          id: String(id), run_id: String(runId), sequence: Number(sequence),
          type: type as TestEvent["type"], occurred_at: String(occurredAt), payload_json: String(payload),
        });
        return { success: true, meta: { changes: 1 } };
      },
    };
    return statement;
  }
}

function event(id: string, runId: string, sequence: number): TestEvent {
  return {
    id, runId, sequence, type: sequence === 1 ? "run.created" : "run.started",
    occurredAt: "2026-11-22T00:00:00.000Z", payload: { sequence },
  };
}

describe("D1EventStore", () => {
  it("persists events and returns a run stream in sequence order", async () => {
    const db = new FakeD1();
    const store = new D1EventStore(db);
    await store.append(event("evt-1", "run-1", 1));
    await store.append(event("evt-2", "run-1", 2));

    await expect(store.listByRun("run-1")).resolves.toEqual([
      event("evt-1", "run-1", 1),
      event("evt-2", "run-1", 2),
    ]);
  });

  it("rejects gaps and duplicate IDs/sequences instead of overwriting history", async () => {
    const db = new FakeD1();
    const store = new D1EventStore(db);
    await expect(store.append(event("evt-2", "run-1", 2))).rejects.toThrow("expected 1");
    await store.append(event("evt-1", "run-1", 1));
    await expect(store.append(event("evt-1", "run-1", 2))).rejects.toThrow("conflict");
    await expect(store.append(event("evt-3", "run-1", 4))).rejects.toThrow("expected 2");
  });

  it("keeps separate run streams independent", async () => {
    const db = new FakeD1();
    const store = new D1EventStore(db);
    await store.append(event("evt-a", "run-a", 1));
    await store.append(event("evt-b", "run-b", 1));
    await expect(store.listByRun("run-a")).resolves.toHaveLength(1);
    await expect(store.listByRun("run-b")).resolves.toHaveLength(1);
  });
});
