import { describe, expect, it } from "vitest";
import { createVoiceActivityDetector } from "./voiceActivityDetector";

describe("Friday energy voice activity detector", () => {
  it("waits for sustained speech before opening a speech segment", () => {
    const vad = createVoiceActivityDetector({ minSpeechMs: 120 });

    expect(vad.pushLevel(0.03, 0)).toEqual([]);
    expect(vad.pushLevel(0.04, 80)).toEqual([]);
    expect(vad.pushLevel(0.05, 125)).toEqual([
      { type: "speechstart", at: 125 },
    ]);
    expect(vad.isSpeechActive()).toBe(true);
  });

  it("uses hysteresis so small level changes do not split speech", () => {
    const vad = createVoiceActivityDetector({
      minSpeechMs: 0,
      startThreshold: 0.02,
      stopThreshold: 0.01,
      silenceMs: 200,
    });

    expect(vad.pushLevel(0.03, 0)).toEqual([
      { type: "speechstart", at: 0 },
    ]);
    expect(vad.pushLevel(0.015, 40)).toEqual([]);
    expect(vad.pushLevel(0.018, 80)).toEqual([]);
    expect(vad.isSpeechActive()).toBe(true);
  });

  it("ends speech only after the configured continuous silence window", () => {
    const vad = createVoiceActivityDetector({
      minSpeechMs: 0,
      silenceMs: 300,
    });

    vad.pushLevel(0.04, 0);
    expect(vad.pushLevel(0.002, 100)).toEqual([]);
    expect(vad.pushLevel(0.003, 350)).toEqual([]);
    expect(vad.pushLevel(0.001, 405)).toEqual([
      { type: "speechend", at: 405 },
    ]);
    expect(vad.isSpeechActive()).toBe(false);
  });

  it("resets a silence candidate when speech resumes before the endpoint", () => {
    const vad = createVoiceActivityDetector({
      minSpeechMs: 0,
      silenceMs: 250,
    });

    vad.pushLevel(0.04, 0);
    vad.pushLevel(0.001, 100);
    expect(vad.pushLevel(0.03, 300)).toEqual([]);
    expect(vad.pushLevel(0.001, 400)).toEqual([]);
    expect(vad.pushLevel(0.001, 649)).toEqual([]);
    expect(vad.pushLevel(0.001, 650)).toEqual([
      { type: "speechend", at: 650 },
    ]);
  });

  it("flushes an active segment once and resets cleanly", () => {
    const vad = createVoiceActivityDetector({ minSpeechMs: 0 });
    vad.pushLevel(0.04, 10);

    expect(vad.flush(20)).toEqual([{ type: "speechend", at: 20 }]);
    expect(vad.flush(30)).toEqual([]);
    expect(vad.isSpeechActive()).toBe(false);

    vad.reset();
    expect(vad.pushLevel(0.04, 0)).toEqual([
      { type: "speechstart", at: 0 },
    ]);
  });

  it("rejects invalid thresholds, levels, and timestamps", () => {
    expect(() => createVoiceActivityDetector({
      startThreshold: 0,
    })).toThrow(RangeError);
    expect(() => createVoiceActivityDetector({
      startThreshold: 0.01,
      stopThreshold: 0.02,
    })).toThrow(RangeError);

    const vad = createVoiceActivityDetector();
    expect(() => vad.pushLevel(-0.1, 0)).toThrow(RangeError);
    expect(() => vad.pushLevel(0.1, Number.NaN)).toThrow(RangeError);
  });
});
