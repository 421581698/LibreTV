"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { MessageLike } from "@/components/friday/FridayPanel";
import type { FridaySourceConfig } from "@/components/friday/useFridaySources";
import type { SearchResultItem, SourceConfig } from "@/lib/types";
import { createLibreTVMovieAgentAdapters } from "@/lib/friday/libretv-movie-adapters";
import { createMovieWorkflowTaskIdPrefix, runLibreTVMovieWorkflow } from "@/lib/friday/movie-workflow";
import { fridayTaskEventStore, fridayTaskRuntime } from "@/lib/friday/task-service";
import type { TaskSnapshot } from "@/lib/friday/task-runtime";
import { isCurrentFridayWorkflow } from "@/components/friday/workflowRequestGuard";

export type FridayWorkflowView = {
  status: "running" | "completed" | "failed";
  sourceChecks?: Array<{ sourceId: string; candidateId?: string; title?: string; reachable: boolean; latencyMs?: number }>;
  qualityChecks?: Array<{ sourceId: string; candidateId?: string; status: "resolution_detected" | "resolution_unknown" | "unavailable" | "unknown"; resolutionHeight: number | null; probeDurationMs?: number | null; probeResultCached?: boolean | null }>;
  review?: { accepted: boolean; findings: string[]; candidateCount: number; assessmentCount: number; measurementCompleted: boolean; resolutionMeasured: boolean };
  error?: string;
};

type FridayChatSessionOptions = {
  sources: FridaySourceConfig[];
  filterAdult: boolean;
  language: "zh" | "en";
  assistantId: "friday" | "jarvis" | "lin-meimei";
  playerActive: boolean;
};

/** Owns Friday's AI SDK transport, chat session and local movie-workflow view state. */
export function useFridayChatSession({
  sources,
  filterAdult,
  language,
  assistantId,
  playerActive,
}: FridayChatSessionOptions) {
  const mountedRef = useRef(false);
  const processedSearchIds = useRef(new Set<string>());
  const activeWorkflowControllers = useRef(new Map<string, AbortController>());
  const [workflowBySearchId, setWorkflowBySearchId] = useState<Record<string, FridayWorkflowView>>({});
  const [restoredTasks, setRestoredTasks] = useState<TaskSnapshot[]>([]);

  const clearTaskHistory = useCallback(async () => {
    await fridayTaskEventStore.clearAll();
    setRestoredTasks([]);
  }, []);

  // Restore the local audit snapshots for display only. Interrupted work is never replayed here.
  useEffect(() => {
    let active = true;
    void fridayTaskRuntime.restoreAll().then((snapshots) => {
      if (active) setRestoredTasks(snapshots);
    }).catch((restoreError) => {
      console.error("[Friday] Could not restore local task history:", restoreError);
    });
    return () => { active = false; };
  }, []);

  const handleData = useCallback((part: { type: string; data?: unknown }) => {
    if (!mountedRef.current) return;
    if (part.type === "data-player-control" && part.data && typeof part.data === "object") {
      window.dispatchEvent(new CustomEvent("friday-player-control", { detail: part.data }));
      return;
    }
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

    const taskIdPrefix = createMovieWorkflowTaskIdPrefix();
    const controller = new AbortController();
    activeWorkflowControllers.current.set(data.searchId, controller);
    void runLibreTVMovieWorkflow({
      query: String(data.keyword || "影视搜索").slice(0, 50),
      taskIdPrefix,
      adapters: workflowAdapters,
      runtime: fridayTaskRuntime,
      signal: controller.signal,
    }).then((workflow) => {
      // A stopped or superseded workflow must never overwrite the current conversation UI.
      if (!mountedRef.current || !isCurrentFridayWorkflow(controller, activeWorkflowControllers.current.get(data.searchId!))) return;
      activeWorkflowControllers.current.delete(data.searchId!);
      const sourceOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.source)?.output as
        | { probes?: Array<{ sourceId: string; candidateId?: string; title?: string; reachable: boolean }> }
        | undefined;
      const qualityOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.quality)?.output as
        | { assessments?: Array<{ sourceId: string; candidateId?: string; status: "resolution_detected" | "resolution_unknown" | "unavailable" | "unknown"; resolutionHeight: number | null; probeDurationMs: number | null; probeResultCached: boolean | null }> }
        | undefined;
      const reviewOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.review)?.output as
        | { accepted?: boolean; findings?: string[]; candidateCount?: number; assessmentCount?: number; measurementCompleted?: boolean; resolutionMeasured?: boolean }
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
            measurementCompleted: reviewOutput.measurementCompleted === true,
            resolutionMeasured: reviewOutput.resolutionMeasured === true,
          },
        },
      }));
    }).catch((error) => {
      // Abort is an expected lifecycle event, not a failed workflow to display to the user.
      if (!mountedRef.current || !isCurrentFridayWorkflow(controller, activeWorkflowControllers.current.get(data.searchId!))) return;
      activeWorkflowControllers.current.delete(data.searchId!);
      console.error("[Friday] V3 movie workflow failed:", error);
      setWorkflowBySearchId((current) => ({
        ...current,
        [data.searchId!]: {
          status: "failed",
          error: error instanceof Error ? error.message : (language === "en" ? "Task execution failed" : "任务执行失败"),
        },
      }));
    });
  }, [sources, filterAdult, language]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { sources, filterAdult, language, assistantId, playerActive },
      }),
    [sources, filterAdult, language, assistantId, playerActive],
  );

  const {
    messages,
    sendMessage,
    status,
    error,
    stop: stopRequest,
    setMessages,
  } = useChat({
    transport,
    onData: handleData,
    onError: (chatError) => {
      console.error("[Friday] Chat error:", chatError);
    },
  });

  const stopChat = useCallback(() => {
    for (const controller of activeWorkflowControllers.current.values()) controller.abort();
    activeWorkflowControllers.current.clear();
    stopRequest();
  }, [stopRequest]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const controller of activeWorkflowControllers.current.values()) controller.abort();
      activeWorkflowControllers.current.clear();
    };
  }, []);

  return {
    typedMessages: messages as unknown as MessageLike[],
    sendMessage,
    status,
    error,
    stop: stopChat,
    setMessages,
    workflowBySearchId,
    restoredTasks,
    clearTaskHistory,
    busy: status === "submitted" || status === "streaming",
  };
}
