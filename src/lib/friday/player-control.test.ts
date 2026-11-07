import { describe, expect, it, vi } from "vitest";
import { executeFridayPlayerCommand, parseFridayPlayerCommand } from "./player-control";
describe("Friday player command validation", () => {
  it("accepts valid commands and rejects unknown or malformed input", () => {
    expect(parseFridayPlayerCommand({ action: "seek_forward", seconds: 15 })?.action).toBe("seek_forward");
    expect(parseFridayPlayerCommand({ action: "delete_video" })).toBeNull();
    expect(parseFridayPlayerCommand({ action: "seek_to", seconds: Number.NaN })).toBeNull();
    expect(parseFridayPlayerCommand(null)).toBeNull();
  });
});
describe("Friday player command execution", () => {
  it("clamps seek operations to the playable range", () => {
    const target = { currentTime: 95, duration: 100 };
    executeFridayPlayerCommand(target, { action: "seek_forward", seconds: 20 });
    expect(target.currentTime).toBe(100);
    executeFridayPlayerCommand(target, { action: "seek_backward", seconds: 200 });
    expect(target.currentTime).toBe(0);
  });
  it("clamps volume and handles mute controls", () => {
    const target = { volume: 0.95, muted: false };
    executeFridayPlayerCommand(target, { action: "volume_up" });
    expect(target.volume).toBe(1);
    executeFridayPlayerCommand(target, { action: "set_volume", volume: 2 });
    expect(target.volume).toBe(1);
    executeFridayPlayerCommand(target, { action: "mute" });
    expect(target.muted).toBe(true);
    executeFridayPlayerCommand(target, { action: "unmute" });
    expect(target.muted).toBe(false);
  });
  it("uses player methods for playback and reports a missing player", () => {
    const play = vi.fn(), pause = vi.fn();
    expect(executeFridayPlayerCommand({ play, pause }, { action: "play" })).toBe(true);
    expect(executeFridayPlayerCommand({ play, pause }, { action: "pause" })).toBe(true);
    expect(play).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
    expect(executeFridayPlayerCommand(null, { action: "pause" })).toBe(false);
  });
});
