export type FridayPersistedMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
};
const HISTORY_VERSION = 1;
const MAX_MESSAGES = 30;
const MAX_TEXT_CHARS = 2000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function sanitizeMessages(value: unknown): FridayPersistedMessage[] {
  if (!Array.isArray(value)) return [];
  const output: FridayPersistedMessage[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const message = item as Record<string, unknown>;
    if (typeof message.id !== "string" || !message.id || message.id.length > 200) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (!Array.isArray(message.parts)) continue;
    const parts = message.parts
      .filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object")
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => ({ type: "text" as const, text: String(part.text).slice(0, MAX_TEXT_CHARS) }))
      .filter((part) => part.text.trim().length > 0);
    if (parts.length === 0 || seen.has(message.id)) continue;
    seen.add(message.id);
    output.push({ id: message.id, role: message.role, parts });
  }
  return output.slice(-MAX_MESSAGES);
}

export function restoreFridayConversationHistory(raw: string | null, now = Date.now()): FridayPersistedMessage[] {
  if (!raw || raw.length > 128 * 1024) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== HISTORY_VERSION || typeof parsed.savedAt !== "number" || !Number.isFinite(parsed.savedAt)) return [];
    const age = now - parsed.savedAt;
    if (age > MAX_AGE_MS || age < -MAX_FUTURE_SKEW_MS) return [];
    return sanitizeMessages(parsed.messages);
  } catch {
    return [];
  }
}

export function serializeFridayConversationHistory(messages: unknown, now = Date.now()): string {
  return JSON.stringify({ version: HISTORY_VERSION, savedAt: now, messages: sanitizeMessages(messages) });
}
