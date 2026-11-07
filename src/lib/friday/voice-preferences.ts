export type FridayVoiceStyle = "auto" | "jarvis" | "warm" | "clear";

export const FRIDAY_VOICE_STORAGE_KEY = "friday-voice-style";
export const FRIDAY_VOICE_CHANGE_EVENT = "friday-voice-preference-change";

export function isFridayVoiceStyle(value: unknown): value is FridayVoiceStyle {
  return value === "auto" || value === "jarvis" || value === "warm" || value === "clear";
}
