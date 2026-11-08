export type FridaySubtitleRole = "user" | "assistant";

const MAX_SUBTITLE_LINES = 6;
const MAX_SUBTITLE_TEXT = 420;

/**
 * Keep the homepage transcript as one continuous subtitle stream.
 * Consecutive partial ASR/TTS updates replace the current speaker line instead
 * of creating chat bubbles or duplicate message rows.
 */
export function upsertFridaySubtitleLine(
  lines: string[],
  role: FridaySubtitleRole,
  text: string,
): string[] {
  const value = text.trim().slice(0, MAX_SUBTITLE_TEXT);
  if (!value) return lines;

  const label = role === "user" ? "你：" : "Friday：";
  const nextLine = `${label}${value}`;
  const next = [...lines];
  const lastIndex = next.length - 1;

  if (lastIndex >= 0 && next[lastIndex].startsWith(label)) {
    next[lastIndex] = nextLine;
  } else {
    next.push(nextLine);
  }

  return next.slice(-MAX_SUBTITLE_LINES);
}
