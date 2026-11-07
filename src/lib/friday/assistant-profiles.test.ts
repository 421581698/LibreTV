import { describe, expect, it } from "vitest";
import {
  buildFridayAssistantSystemPrompt,
  getFridayAssistantProfile,
  isFridayAssistantId,
} from "./assistant-profiles";

describe("Friday assistant profiles", () => {
  it("accepts only known profile identifiers", () => {
    expect(isFridayAssistantId("friday")).toBe(true);
    expect(isFridayAssistantId("jarvis")).toBe(true);
    expect(isFridayAssistantId("lin-meimei")).toBe(true);
    expect(isFridayAssistantId("admin")).toBe(false);
    expect(isFridayAssistantId({ id: "jarvis" })).toBe(false);
  });

  it("falls back to Friday for unknown identifiers", () => {
    expect(getFridayAssistantProfile("unknown").id).toBe("friday");
    expect(getFridayAssistantProfile(null).id).toBe("friday");
  });

  it("exposes player controls only when a playback page is active", () => {
    expect(buildFridayAssistantSystemPrompt("friday", "zh", true)).toContain("调用 control_player");
    expect(buildFridayAssistantSystemPrompt("friday", "zh", false)).toContain("不要调用播放器控制工具");
  });

  it("builds language-specific prompts without exposing credentials", () => {
    const chinese = buildFridayAssistantSystemPrompt("jarvis", "zh");
    const english = buildFridayAssistantSystemPrompt("lin-meimei", "en");

    expect(chinese).toContain("你是 Jarvis");
    expect(chinese).toContain("简体中文");
    expect(english).toContain("natural, concise English");
    expect(english).toContain("温柔、细腻");
    expect(chinese).not.toMatch(/API[_ -]?KEY\s*[:=]/i);
  });
});
