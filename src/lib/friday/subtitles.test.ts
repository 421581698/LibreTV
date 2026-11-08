import { describe, expect, it } from "vitest";
import { upsertFridaySubtitleLine } from "./subtitles";

describe("Friday continuous subtitles", () => {
  it("updates interim user text and streamed assistant text without duplicate rows", () => {
    let lines: string[] = [];
    lines = upsertFridaySubtitleLine(lines, "user", "我想看科幻");
    lines = upsertFridaySubtitleLine(lines, "user", "我想看科幻电影");
    lines = upsertFridaySubtitleLine(lines, "assistant", "我来帮你找");
    lines = upsertFridaySubtitleLine(lines, "assistant", "我来帮你找几部科幻电影");

    expect(lines).toEqual(["你：我想看科幻电影", "Friday：我来帮你找几部科幻电影"]);
  });

  it("starts a new subtitle line when the speaker changes and keeps only recent lines", () => {
    let lines: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      lines = upsertFridaySubtitleLine(lines, index % 2 === 0 ? "user" : "assistant", `turn ${index}`);
    }
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe("你：turn 2");
    expect(lines[5]).toBe("Friday：turn 7");
  });

  it("ignores blank captions and bounds each line", () => {
    expect(upsertFridaySubtitleLine([], "user", "   ")).toEqual([]);
    const lines = upsertFridaySubtitleLine([], "assistant", "x".repeat(500));
    expect(lines[0]).toHaveLength("Friday：".length + 420);
  });
});
