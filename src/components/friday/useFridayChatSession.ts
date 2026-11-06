"use client";

import { useCallback, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { MessageLike } from "@/components/friday/FridayPanel";
import type { FridaySourceConfig } from "@/components/friday/useFridaySources";
import type { SearchResultItem, SourceConfig } from "@/lib/types";
import { createLibreTVMovieAgentAdapters } from "@/lib/friday/libretv-movie-adapters";
import { runLibreTVMovieWorkflow } from "@/lib/friday/movie-workflow";
import { fridayTaskRuntime } from "@/lib/friday/task-service";

type FridayChatSessionOptions = {
  sources: FridaySourceConfig[];
  filterAdult: boolean;
};

/** Owns Friday's AI SDK transport and chat session state. */
export function useFridayChatSession({
  sources,
  filterAdult,
}: FridayChatSessionOptions) {
  const processedSearchIds = useRef(new Set<string>());

  const handleData = useCallback((part: { type: string; data?: unknown }) => {
    if (part.type !== "data-movies" || !part.data || typeof part.data !== "object") return;
    const data = part.data as {
      searchId?: string;
      keyword?: string;
      results?: SearchResultItem[];
    };
    if (!data.searchId || processedSearchIds.current.has(data.searchId)) return;
    processedSearchIds.current.add(data.searchId);

    const movieResults = Array.isArray(data.results) ? data.results : [];
    const adapters = createLibreTVMovieAgentAdapters(
      sources as SourceConfig[],
      { filterAdult },
    );
    // Search has already completed on the server and arrived as trusted application data.
    // Reuse those exact results in the DAG instead of issuing a second movie search.
    const workflowAdapters = {
      ...adapters,
      search: async () => movieResults.map((item) => ({
        id: `${item.sourceKey}:${item.vodId}`,
        title: item.name,
        sourceId: item.sourceKey,
        evidence: ["server search_movie result"],
      })),
    };

    const taskIdPrefix = `friday-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    void runLibreTVMovieWorkflow({
      query: String(data.keyword || "影视搜索").slice(0, 50),
      taskIdPrefix,
      adapters: workflowAdapters,
      runtime: fridayTaskRuntime,
    }).catch((error) => {
      console.error("[Friday] V3 movie workflow failed:", error);
    });
  }, [sources, filterAdult]);

  const transport = useMemo((
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { sources, filterAdult },
      }),
    [sources, filterAdult],
  );

  const {
    messages,
    sendMessage,
    status,
    error,
    stop,
    setMessages,
  } = useChat({
    transport,
    onData: handleData,
    onError: (chatError) => {
      console.error("[Friday] Chat error:", chatError);
    },
  });

  return {
    typedMessages: messages as unknown as MessageLike[],
    sendMessage,
    status,
    error,
    stop,
    setMessages,
    busy: status === "submitted" || status === "streaming",
  };
}
