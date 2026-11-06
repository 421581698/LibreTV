"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { MessageLike } from "@/components/friday/FridayPanel";
import type { FridaySourceConfig } from "@/components/friday/useFridaySources";
import type { SearchResultItem, SourceConfig } from "@/lib/types";
import { createLibreTVMovieAgentAdapters } from "@/lib/friday/libretv-movie-adapters";
import { runLibreTVMovieWorkflow } from "@/lib/friday/movie-workflow";
import { fridayTaskRuntime } from "@/lib/friday/task-service";

export type FridayWorkflowView = {
  status: "running" | "completed" | "failed";
  sourceChecks?: Array<{ sourceId: string; candidateId?: string; title?: string; reachable: boolean; latencyMs?: number }>;
  qualityChecks?: Array<{ sourceId: string; candidateId?: string; status: "resolution_detected" | "resolution_unknown" | "unavailable" | "unknown"; resolutionHeight: number | null }>;
  review?: { accepted: boolean; findings: string[]; candidateCount: number; assessmentCount: number };
  error?: string;
};

type FridayChatSessionOptions = {
  sources: FridaySourceConfig[];
  filterAdult: boolean;
  language: "zh" | "en";
};

/** Owns Friday's AI SDK transport, chat session and local movie-workflow view state. */
export function useFridayChatSession({
  sources,
  filterAdult,
  language,
}: FridayChatSessionOptions) {
  const processedSearchIds = useRef(new Set<string>());
  const [workflowBySearchId, setWorkflowBySearchId] = useState<Record<string, FridayWorkflowView>>({});

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
    // Reuse the exact server search results; do not issue a duplicate movie search.
    const workflowAdapters = {
      ...adapters,
      search: async () => movieResults.map((item) => ({
        id: `${item.sourceKey}:${item.vodId}`,
        title: item.name,
        sourceId: item.sourceKey,
        vodId: String(item.vodId),
        evidence: ["server search_movie result"],
      })),
    };

    setWorkflowBySearchId((current) => ({
      ...current,
      [data.searchId!]: { status: "running" },
    }));

    const taskIdPrefix = `friday-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    void runLibreTVMovieWorkflow({
      query: String(data.keyword || "影视搜索").slice(0, 50),
      taskIdPrefix,
      adapters: workflowAdapters,
      runtime: fridayTaskRuntime,
    }).then((workflow) => {
      const sourceOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.source)?.output as
        | { probes?: Array<{ sourceId: string; candidateId?: string; title?: string; reachable: boolean }> }
        | undefined;
      const qualityOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.quality)?.output as
        | { assessments?: Array<{ sourceId: string; candidateId?: string; status: "resolution_detected" | "resolution_unknown" | "unavailable" | "unknown"; resolutionHeight: number | null }> }
        | undefined;
      const reviewOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.review)?.output as
        | { accepted?: boolean; findings?: string[]; candidateCount?: number; assessmentCount?: number }
        | undefined;
      setWorkflowBySearchId((current) => ({
        ...current,
        [data.searchId!]: {
          status: workflow.results.every((item) => item.status === "succeeded") ? "completed" : "failed",
          sourceChecks: sourceOutput?.probes ?? [],
          qualityChecks: qualityOutput?.assessments ?? [],
          review: reviewOutput && {
            accepted: reviewOutput.accepted === true,
            findings: reviewOutput.findings ?? [],
            candidateCount: reviewOutput.candidateCount ?? movieResults.length,
            assessmentCount: reviewOutput.assessmentCount ?? 0,
          },
        },
      }));
    }).catch((error) => {
      console.error("[Friday] V3 movie workflow failed:", error);
      setWorkflowBySearchId((current) => ({
        ...current,
        [data.searchId!]: {
          status: "failed",
          error: error instanceof Error ? error.message : "任务执行失败",
        },
      }));
    });
  }, [sources, filterAdult]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { sources, filterAdult, language },
      }),
    [sources, filterAdult, language],
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
    workflowBySearchId,
    busy: status === "submitted" || status === "streaming",
  };
}
