import { describe, expect, it } from "vitest";
import { restoreFridayConversationHistory, serializeFridayConversationHistory } from "./conversation-history";

describe("Friday browser-local conversation history", () => {
  it("round-trips user and assistant text while excluding tool/data payloads", () => {
    const raw = serializeFridayConversationHistory([
      { id: "u1", role: "user", parts: [{ type: "text", text: "你好" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "我在" }, { type: "data-movies", data: { private: true } }] },
      { id: "tool1", role: "tool", parts: [{ type: "text", text: "not persisted" }] },
    ], 1000);
    expect(restoreFridayConversationHistory(raw, 2000)).toEqual([
      { id: "u1", role: "user", parts: [{ type: "text", text: "你好" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "我在" }] },
    ]);
  });
  it("rejects corrupt, expired, future-dated, and oversized snapshots", () => {
    expect(restoreFridayConversationHistory("{broken", 1000)).toEqual([]);
    expect(restoreFridayConversationHistory(JSON.stringify({ version: 1, savedAt: 0, messages: [] }), 31 * 24 * 60 * 60 * 1000)).toEqual([]);
    expect(restoreFridayConversationHistory(JSON.stringify({ version: 1, savedAt: 999999, messages: [] }), 1000)).toEqual([]);
    expect(restoreFridayConversationHistory("x".repeat(128 * 1024 + 1), 1000)).toEqual([]);
  });
  it("bounds message count and text length and drops duplicate ids", () => {
    const messages = Array.from({ length: 34 }, (_, index) => ({
      id: `m${index}`, role: "user", parts: [{ type: "text", text: "x".repeat(2500) }],
    }));
    messages.push({ id: "m33", role: "user", parts: [{ type: "text", text: "duplicate" }] });
    const restored = restoreFridayConversationHistory(serializeFridayConversationHistory(messages, 1000), 1000);
    expect(restored).toHaveLength(30);
    expect(restored[0].id).toBe("m4");
    expect(restored[29].parts[0].text).toHaveLength(2000);
  });
});
