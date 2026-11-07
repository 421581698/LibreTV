export type FridayPlayerAction = "play" | "pause" | "toggle" | "seek_to" | "seek_forward" | "seek_backward" | "volume_up" | "volume_down" | "set_volume" | "mute" | "unmute" | "fullscreen";
export type FridayPlayerCommand = { commandId?: string; action: FridayPlayerAction; seconds?: number; volume?: number };
export type FridayPlayerControlTarget = {
  play?: () => unknown; pause?: () => unknown; toggle?: () => unknown;
  currentTime?: number; duration?: number; volume?: number; muted?: boolean; paused?: boolean; fullscreen?: boolean;
};
const ACTIONS = new Set<FridayPlayerAction>(["play","pause","toggle","seek_to","seek_forward","seek_backward","volume_up","volume_down","set_volume","mute","unmute","fullscreen"]);
export function parseFridayPlayerCommand(value: unknown): FridayPlayerCommand | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.action !== "string" || !ACTIONS.has(input.action as FridayPlayerAction)) return null;
  if (input.seconds !== undefined && (typeof input.seconds !== "number" || !Number.isFinite(input.seconds))) return null;
  if (input.volume !== undefined && (typeof input.volume !== "number" || !Number.isFinite(input.volume))) return null;
  if (input.commandId !== undefined && (typeof input.commandId !== "string" || input.commandId.length > 100)) return null;
  return { commandId: typeof input.commandId === "string" ? input.commandId : undefined, action: input.action as FridayPlayerAction, seconds: typeof input.seconds === "number" ? input.seconds : undefined, volume: typeof input.volume === "number" ? input.volume : undefined };
}
export function executeFridayPlayerCommand(target: FridayPlayerControlTarget | null | undefined, command: FridayPlayerCommand): boolean {
  if (!target) return false;
  const currentTime = typeof target.currentTime === "number" && Number.isFinite(target.currentTime) ? Math.max(0, target.currentTime) : 0;
  const duration = typeof target.duration === "number" && Number.isFinite(target.duration) && target.duration > 0 ? target.duration : Number.POSITIVE_INFINITY;
  const volume = typeof target.volume === "number" && Number.isFinite(target.volume) ? Math.min(1, Math.max(0, target.volume)) : 1;
  const seek = (value: number) => { target.currentTime = Math.min(duration, Math.max(0, value)); };
  switch (command.action) {
    case "play": if (!target.play) return false; void target.play(); return true;
    case "pause": if (!target.pause) return false; target.pause(); return true;
    case "toggle": if (target.toggle) target.toggle(); else if (target.paused === true && target.play) void target.play(); else if (target.paused === false && target.pause) target.pause(); else return false; return true;
    case "seek_to": if (command.seconds === undefined) return false; seek(command.seconds); return true;
    case "seek_forward": seek(currentTime + Math.min(3600, Math.max(1, command.seconds ?? 10))); return true;
    case "seek_backward": seek(currentTime - Math.min(3600, Math.max(1, command.seconds ?? 10))); return true;
    case "volume_up": target.volume = Math.min(1, volume + 0.1); return true;
    case "volume_down": target.volume = Math.max(0, volume - 0.1); return true;
    case "set_volume": if (command.volume === undefined) return false; target.volume = Math.min(1, Math.max(0, command.volume)); return true;
    case "mute": target.muted = true; return true;
    case "unmute": target.muted = false; return true;
    case "fullscreen": if (typeof target.fullscreen !== "boolean") return false; target.fullscreen = !target.fullscreen; return true;
    default: return false;
  }
}
