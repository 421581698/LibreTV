"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Dispatch } from "react";
import type { FridayEvent } from "@/lib/friday/types";

type ToolPartLike = {
  type?: string;
  state?: string;
  toolCallId?: string;
  data?: unknown;
};

export function hasMovieResultData(data: unknown): boolean {
  return Boolean(
    data &&
      typeof data === "object" &&
      "results" in data &&
      Array.isArray((data as { results?: unknown }).results),
  );
}

type RequestMessageLike = {
  id: string;
  parts?: ToolPartLike[];
};

type FridayRequestLifecycleOptions = {
  busy: boolean;
  error?: { message?: string } | null;
  messages?: RequestMessageLike[];
  dispatchMachine: Dispatch<FridayEvent>;
};

export function useFridayRequestLifecycle({
  busy,
  error,
  messages = [],
  dispatchMachine,
}: FridayRequestLifecycleOptions) {
  const requestSequenceRef = useRef(0);
  const activeRequestIdRef = useRef(0);
  const observedBusyRef = useRef(false);
  const observedToolStatesRef = useRef(new Map<string, string>());
  const activeToolCallsRef = useRef(new Set<string>());
  const messagesRef = useRef(messages);
  const baselineMessageIdsRef = useRef(new Set<string>());
  const renderingDispatchedRef = useRef(false);
  messagesRef.current = messages;

  const beginRequest = useCallback(() => {
    const requestId = ++requestSequenceRef.current;
    activeRequestIdRef.current = requestId;
    observedBusyRef.current = false;
    observedToolStatesRef.current.clear();
    activeToolCallsRef.current.clear();
    renderingDispatchedRef.current = false;
    baselineMessageIdsRef.current = new Set(messagesRef.current.map((message) => message.id));
    dispatchMachine({ type: "MESSAGE_SUBMITTED", requestId });
    return requestId;
  }, [dispatchMachine]);

  const failActiveRequest = useCallback(
    (code: string, message: string) => {
      const requestId = activeRequestIdRef.current;
      if (!requestId) return;

      dispatchMachine({
        type: "REQUEST_FAILED",
        requestId,
        code,
        message,
      });
      activeRequestIdRef.current = 0;
      observedBusyRef.current = false;
      observedToolStatesRef.current.clear();
      activeToolCallsRef.current.clear();
      baselineMessageIdsRef.current.clear();
      renderingDispatchedRef.current = false;
    },
    [dispatchMachine],
  );

  const cancelActiveRequest = useCallback(() => {
    const requestId = activeRequestIdRef.current;
    if (!requestId) return;

    dispatchMachine({ type: "REQUEST_CANCELLED", requestId });
    activeRequestIdRef.current = 0;
    observedBusyRef.current = false;
    observedToolStatesRef.current.clear();
    activeToolCallsRef.current.clear();
    baselineMessageIdsRef.current.clear();
    renderingDispatchedRef.current = false;
  }, [dispatchMachine]);

  useEffect(() => {
    const requestId = activeRequestIdRef.current;
    if (!requestId) return;

    // AI SDK 将服务端工具执行过程作为 tool-* message parts 写回消息。
    // data-movies 是实际搜索结果事件；只在新消息出现真实结果时进入 rendering。
    let hasMovieResults = false;
    for (const message of messages) {
      if (baselineMessageIdsRef.current.has(message.id)) continue;
      for (let index = 0; index < (message.parts?.length ?? 0); index += 1) {
        const part = message.parts?.[index];
        if (part?.type === "data-movies" && hasMovieResultData(part.data)) {
          hasMovieResults = true;
        }
        if (!part?.type?.startsWith("tool-")) continue;

        const key = `${message.id}:${part.toolCallId || index}`;
        const previousState = observedToolStatesRef.current.get(key);
        if (previousState === part.state) continue;

        if (part.state === "input-available" && !activeToolCallsRef.current.has(key)) {
          if (activeToolCallsRef.current.size === 0) {
            dispatchMachine({ type: "TOOL_STARTED", requestId });
          }
          activeToolCallsRef.current.add(key);
        } else if (
          (part.state === "output-available" || part.state === "output-error") &&
          activeToolCallsRef.current.delete(key) &&
          activeToolCallsRef.current.size === 0
        ) {
          dispatchMachine({ type: "TOOL_FINISHED", requestId });
        }

        if (part.state) {
          observedToolStatesRef.current.set(key, part.state);
        }
      }
    }

    if (hasMovieResults && !renderingDispatchedRef.current) {
      renderingDispatchedRef.current = true;
      dispatchMachine({ type: "RESPONSE_RENDERING", requestId });
    }

    if (error) {
      dispatchMachine({
        type: "REQUEST_FAILED",
        requestId,
        code: "chat_request_failed",
        message: error.message || "消息请求失败",
      });
      activeRequestIdRef.current = 0;
      observedBusyRef.current = false;
      observedToolStatesRef.current.clear();
      activeToolCallsRef.current.clear();
      baselineMessageIdsRef.current.clear();
      renderingDispatchedRef.current = false;
      return;
    }

    if (busy) {
      observedBusyRef.current = true;
      return;
    }

    if (observedBusyRef.current) {
      dispatchMachine({ type: "RESPONSE_COMPLETED", requestId });
      activeRequestIdRef.current = 0;
      observedBusyRef.current = false;
      observedToolStatesRef.current.clear();
      activeToolCallsRef.current.clear();
      baselineMessageIdsRef.current.clear();
      renderingDispatchedRef.current = false;
    }
  }, [busy, error, messages, dispatchMachine]);

  return { beginRequest, failActiveRequest, cancelActiveRequest };
}
