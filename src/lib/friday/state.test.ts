import { describe, expect, it } from "vitest";

import { fridayReducer, initialFridayState } from "./state";
import { hasMovieResultData } from "@/components/friday/useFridayRequestLifecycle";
import {
  canResumeVoiceSession,
  getSpeechErrorMessage,
  getSpeechStartErrorMessage,
  shouldEndVoiceSession,
} from "@/components/friday/useFridayVoiceController";

describe("fridayReducer", () => {
  it("opens, expands, collapses and closes the surface", () => {
    const opened = fridayReducer(initialFridayState, { type: "OPEN" });
    expect(opened.surface).toBe("launcher");

    const expanded = fridayReducer(opened, { type: "EXPAND" });
    expect(expanded.surface).toBe("expanded");

    const collapsed = fridayReducer(expanded, { type: "COLLAPSE" });
    expect(collapsed.surface).toBe("compact");

    const closed = fridayReducer(collapsed, { type: "CLOSE" });
    expect(closed.surface).toBe("closed");
    expect(closed.voice).toBe("idle");
  });

  it("tracks a complete voice recognition lifecycle", () => {
    let state = fridayReducer(initialFridayState, {
      type: "VOICE_START_REQUESTED",
      sessionId: 1,
    });
    expect(state.voice).toBe("requesting");

    state = fridayReducer(state, { type: "VOICE_STARTED", sessionId: 1 });
    expect(state.voice).toBe("listening");

    state = fridayReducer(state, { type: "VOICE_FINAL_TEXT", sessionId: 1 });
    expect(state.voice).toBe("recognizing");

    state = fridayReducer(state, { type: "VOICE_ENDED", sessionId: 1 });
    expect(state.voice).toBe("idle");
  });

  it("preserves a synchronous voice startup failure after ending the session", () => {
    let state = fridayReducer(initialFridayState, {
      type: "VOICE_START_REQUESTED",
      sessionId: 5,
    });

    state = fridayReducer(state, {
      type: "VOICE_STOP",
      sessionId: 5,
    });
    state = fridayReducer(state, {
      type: "VOICE_FAILED",
      sessionId: 5,
      code: "NotAllowedError",
      message: "Microphone permission denied",
    });

    expect(state.voice).toBe("error");
    expect(state.errors.voice?.code).toBe("NotAllowedError");
  });

  it("ignores stale voice callbacks", () => {
    const state = fridayReducer(initialFridayState, {
      type: "VOICE_START_REQUESTED",
      sessionId: 7,
    });

    const stale = fridayReducer(state, {
      type: "VOICE_STARTED",
      sessionId: 6,
    });

    expect(stale).toBe(state);
  });

  it("supports repeated tool execution cycles for one request", () => {
    let state = fridayReducer(initialFridayState, { type: "OPEN" });
    state = fridayReducer(state, {
      type: "MESSAGE_SUBMITTED",
      requestId: 10,
    });

    state = fridayReducer(state, { type: "TOOL_STARTED", requestId: 10 });
    expect(state.agent).toBe("executing");

    state = fridayReducer(state, { type: "TOOL_FINISHED", requestId: 10 });
    expect(state.agent).toBe("thinking");

    state = fridayReducer(state, { type: "TOOL_STARTED", requestId: 10 });
    expect(state.agent).toBe("executing");

    state = fridayReducer(state, { type: "TOOL_FINISHED", requestId: 10 });
    expect(state.agent).toBe("thinking");

    state = fridayReducer(state, {
      type: "RESPONSE_RENDERING",
      requestId: 10,
    });
    expect(state.agent).toBe("rendering");

    state = fridayReducer(state, {
      type: "RESPONSE_COMPLETED",
      requestId: 10,
    });
    expect(state.agent).toBe("completed");
    expect(state.surface).toBe("result");
  });

  it("ignores stale agent events from older requests", () => {
    const state = fridayReducer(initialFridayState, {
      type: "MESSAGE_SUBMITTED",
      requestId: 2,
    });

    const stale = fridayReducer(state, {
      type: "TOOL_STARTED",
      requestId: 1,
    });

    expect(stale).toBe(state);
  });

  it("keeps voice and agent errors isolated", () => {
    let state = fridayReducer(initialFridayState, {
      type: "VOICE_START_REQUESTED",
      sessionId: 3,
    });

    state = fridayReducer(state, {
      type: "VOICE_FAILED",
      sessionId: 3,
      code: "not-allowed",
      message: "Microphone permission denied",
    });

    state = fridayReducer(state, {
      type: "MESSAGE_SUBMITTED",
      requestId: 4,
    });

    state = fridayReducer(state, {
      type: "REQUEST_FAILED",
      requestId: 4,
      code: "network",
      message: "Request failed",
    });

    expect(state.errors.voice?.code).toBe("not-allowed");
    expect(state.errors.agent?.code).toBe("network");
  });

  it("ignores late completion and tool events after a request is cancelled", () => {
    let state = fridayReducer(initialFridayState, {
      type: "MESSAGE_SUBMITTED",
      requestId: 1,
    });

    state = fridayReducer(state, {
      type: "REQUEST_CANCELLED",
      requestId: 1,
    });
    expect(state.agent).toBe("idle");
    expect(state.requestId).toBe(2);

    const lateTool = fridayReducer(state, {
      type: "TOOL_STARTED",
      requestId: 1,
    });
    const lateCompletion = fridayReducer(state, {
      type: "RESPONSE_COMPLETED",
      requestId: 1,
    });

    expect(lateTool).toBe(state);
    expect(lateCompletion).toBe(state);
  });

  it("does not reopen a closed surface when a request completes", () => {
    let state = fridayReducer(initialFridayState, {
      type: "MESSAGE_SUBMITTED",
      requestId: 5,
    });

    state = fridayReducer(state, { type: "CLOSE" });
    state = fridayReducer(state, {
      type: "RESPONSE_COMPLETED",
      requestId: 5,
    });

    expect(state.surface).toBe("closed");
    expect(state.agent).toBe("completed");
  });

  it("clears an agent error when a new request starts", () => {
    let state = fridayReducer(initialFridayState, {
      type: "MESSAGE_SUBMITTED",
      requestId: 8,
    });

    state = fridayReducer(state, {
      type: "REQUEST_FAILED",
      requestId: 8,
      code: "timeout",
      message: "Timed out",
    });

    state = fridayReducer(state, {
      type: "MESSAGE_SUBMITTED",
      requestId: 9,
    });

    expect(state.agent).toBe("thinking");
    expect(state.errors.agent).toBeUndefined();
  });
});


describe("Friday voice error handling", () => {
  it("explains microphone permission denial from the recognition API", () => {
    expect(getSpeechErrorMessage("not-allowed")).toContain("权限被拒绝");
    expect(getSpeechErrorMessage("service-not-allowed")).toContain("权限被拒绝");
  });

  it("explains synchronous microphone startup failures by browser error name", () => {
    expect(getSpeechStartErrorMessage({ name: "NotAllowedError" })).toContain("权限被拒绝");
    expect(getSpeechStartErrorMessage({ name: "SecurityError" })).toContain("HTTPS");
    expect(getSpeechStartErrorMessage({ name: "NotFoundError" })).toContain("没有检测到可用的麦克风");
    expect(getSpeechStartErrorMessage({ name: "NotReadableError" })).toContain("其他应用占用");
  });

  it("asks for a manual retry when automatic listening cannot resume", () => {
    expect(getSpeechStartErrorMessage(new Error(), true)).toContain("点击麦克风继续聆听");
  });

  it("ends blocked sessions but preserves retry after silence or cancellation", () => {
    expect(shouldEndVoiceSession("not-allowed")).toBe(true);
    expect(shouldEndVoiceSession("network")).toBe(true);
    expect(shouldEndVoiceSession("no-speech")).toBe(false);
    expect(shouldEndVoiceSession("aborted")).toBe(false);
  });

  it("resumes listening only while the voice session remains eligible", () => {
    const eligible = {
      sessionActive: true,
      panelOpen: true,
      closing: false,
      busy: false,
      listening: false,
      speaking: false,
    };

    expect(canResumeVoiceSession(eligible)).toBe(true);
    expect(canResumeVoiceSession({ ...eligible, sessionActive: false })).toBe(false);
    expect(canResumeVoiceSession({ ...eligible, panelOpen: false })).toBe(false);
    expect(canResumeVoiceSession({ ...eligible, closing: true })).toBe(false);
    expect(canResumeVoiceSession({ ...eligible, busy: true })).toBe(false);
    expect(canResumeVoiceSession({ ...eligible, listening: true })).toBe(false);
    expect(canResumeVoiceSession({ ...eligible, speaking: true })).toBe(false);
  });
});


describe("Friday movie result lifecycle", () => {
  it("enters result rendering only for a movie data payload with a results array", () => {
    expect(hasMovieResultData({
      searchId: "search-1",
      results: [],
    })).toBe(true);
    expect(hasMovieResultData({ results: [{ name: "真实影片" }] })).toBe(true);
    expect(hasMovieResultData({})).toBe(false);
    expect(hasMovieResultData({ results: null })).toBe(false);
    expect(hasMovieResultData({ results: "not-an-array" })).toBe(false);
    expect(hasMovieResultData(null)).toBe(false);
  });
});


describe("Friday failed request lifecycle", () => {
  it("invalidates late tool and completion events after a request fails", () => {
    let state = fridayReducer(initialFridayState, {
      type: "MESSAGE_SUBMITTED",
      requestId: 1,
    });

    state = fridayReducer(state, {
      type: "REQUEST_FAILED",
      requestId: 1,
      code: "network",
      message: "Request failed",
    });

    expect(state.agent).toBe("error");
    expect(state.requestId).toBe(2);
    expect(state.errors.agent?.code).toBe("network");

    const lateTool = fridayReducer(state, {
      type: "TOOL_STARTED",
      requestId: 1,
    });
    const lateCompletion = fridayReducer(state, {
      type: "RESPONSE_COMPLETED",
      requestId: 1,
    });

    expect(lateTool).toBe(state);
    expect(lateCompletion).toBe(state);
    expect(lateCompletion.agent).toBe("error");
  });

  it("uses the next request id after a failed request", () => {
    let state = fridayReducer(initialFridayState, {
      type: "MESSAGE_SUBMITTED",
      requestId: 1,
    });
    state = fridayReducer(state, {
      type: "REQUEST_FAILED",
      requestId: 1,
      code: "network",
      message: "Request failed",
    });
    state = fridayReducer(state, {
      type: "MESSAGE_SUBMITTED",
      requestId: 2,
    });

    expect(state.requestId).toBe(2);
    expect(state.agent).toBe("thinking");
    expect(state.errors.agent).toBeUndefined();
  });
});
