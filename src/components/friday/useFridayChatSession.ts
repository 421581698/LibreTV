"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { MessageLike } from "@/components/friday/FridayPanel";
import type { FridaySourceConfig } from "@/components/friday/useFridaySources";
import type { SearchResultItem, SourceConfig } from "@/lib/types";
import { readQuality } from "@/lib/store";
import { createLibreTVMovieAgentAdapters } from "@/lib/friday/libretv-movie-adapters";
import { createMovieWorkflowTaskIdPrefix, runLibreTVMovieWorkflow } from "@/lib/friday/movie-workflow";
import { fridayTaskEventStore, fridayTaskRuntime } from "@/lib/friday/task-service";
import type { TaskSnapshot } from "@/lib/friday/task-runtime";
import type { MovieAgentAdapters } from "@/lib/friday/movie-agents";
import { isCurrentFridayWorkflow } from "@/components/friday/workflowRequestGuard";
import { restoreFridayConversationHistory, serializeFridayConversationHistory } from "@/lib/friday/conversation-history";

export type FridayWorkflowView = {
  status: "running" | "completed" | "failed";
  sourceChecks?: Array<{ sourceId: string; candidateId?: string; title?: string; reachable: boolean; latencyMs?: number; originTtfbMs?: number; probeDurationMs?: number }>;
  qualityChecks?: Array<{ sourceId: string; candidateId?: string; status: "resolution_detected" | "resolution_unknown" | "unavailable" | "unknown"; resolutionHeight: number | null; decodedResolutionHeight?: number | null; resolutionSource?: "decoded_playback" | "playlist_or_segment" | "unknown"; originTtfbMs?: number | null; probeDurationMs?: number | null; probeResultCached?: boolean | null }>;
  review?: { accepted: boolean; findings: string[]; candidateCount: number; assessmentCount: number; measurementCompleted: boolean; resolutionMeasured: boolean };
  playbackRecommendations?: Array<{
    title: string;
    candidateId: string;
    sourceId: string;
    resolutionHeight: number | null;
    selectionBasis: "measured-resolution" | "reachable-only";
    alternativeCount: number;
  }>;
  error?: string;
  retryable?: boolean;
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
  const workflowContexts = useRef(new Map<string, { query: string; taskIdPrefix: string; adapters: MovieAgentAdapters }>());
  const [workflowBySearchId, setWorkflowBySearchId] = useState<Record<string, FridayWorkflowView>>({});
  const [restoredTasks, setRestoredTasks] = useState<TaskSnapshot[]>([]);

  const clearTaskHistory = useCallback(async () => {
    await fridayTaskEventStore.clearAll();
    setRestoredTasks([]);
  }, []);

  // Restore browser-local task history and safely resume interrupted read-only workflows.
  // Player/device side effects are never replayed by TaskRuntime.
  const recoveredWorkflowPrefixes = useRef(new Set<string>());
  const recoveryControllers = useRef(new Map<string, AbortController>());
  useEffect(() => {
    let active = true;
    if (sources.length === 0) return () => { active = false; };
    void fridayTaskRuntime.restoreAll().then(async (snapshots) => {
      if (!active) return;
      setRestoredTasks(snapshots);
      const roots = snapshots.filter((snapshot) =>
        snapshot.agent === "search-agent" && snapshot.taskId.endsWith(".search"),
      );
      for (const root of roots) {
        const taskIdPrefix = root.taskId.slice(0, -".search".length);
        const related = snapshots.filter((snapshot) => snapshot.taskId.startsWith(taskIdPrefix + "."));
        const interrupted = related.some((snapshot) =>
          snapshot.status === "failed" && snapshot.error?.code === "TASK_INTERRUPTED" && snapshot.error.retryable,
        );
        if (!interrupted || recoveredWorkflowPrefixes.current.has(taskIdPrefix)) continue;
        const input = root.input as { query?: unknown };
        const query = typeof input?.query === "string" ? input.query.trim() : "";
        if (!query) continue;

        recoveredWorkflowPrefixes.current.add(taskIdPrefix);
        const adapters = createLibreTVMovieAgentAdapters(sources as SourceConfig[], {
          filterAdult,
          readDecodedHeight: (candidate) => {
            if (!candidate.sourceId || !candidate.vodId) return undefined;
            const quality = readQuality(candidate.sourceId, candidate.vodId);
            return quality?.from === "play" ? quality.height : undefined;
          },
        });
        workflowContexts.current.set(taskIdPrefix, { query, taskIdPrefix, adapters });
        const controller = new AbortController();
        activeWorkflowControllers.current.set(taskIdPrefix, controller);
        recoveryControllers.current.set(taskIdPrefix, controller);
        setWorkflowBySearchId((current) => ({
          ...current,
          [taskIdPrefix]: { status: "running" },
        }));
        try {
          const workflow = await runLibreTVMovieWorkflow({
            query,
            taskIdPrefix,
            adapters,
            runtime: fridayTaskRuntime,
            signal: controller.signal,
            replayFailed: true,
          });
          if (!active) return;
          activeWorkflowControllers.current.delete(taskIdPrefix);
          recoveryControllers.current.delete(taskIdPrefix);
          setWorkflowBySearchId((current) => ({
            ...current,
            [taskIdPrefix]: {
              status: workflow.results.every((item) => item.status === "succeeded") ? "completed" : "failed",
              retryable: workflow.results.some((item) => item.status === "failed" && item.error?.retryable === true),
            },
          }));
        } catch (recoveryError) {
          if (!active) return;
          activeWorkflowControllers.current.delete(taskIdPrefix);
          recoveryControllers.current.delete(taskIdPrefix);
          setWorkflowBySearchId((current) => ({
            ...current,
            [taskIdPrefix]: {
              status: "failed",
              error: recoveryError instanceof Error ? recoveryError.message : "Interrupted workflow recovery failed",
              retryable: false,
            },
          }));
        }
        if (active) setRestoredTasks(await fridayTaskRuntime.restoreAll());
      }
    }).catch((restoreError) => {
      console.error("[Friday] Could not restore local task history:", restoreError);
    });
    return () => {
      active = false;
      for (const [prefix, controller] of recoveryControllers.current) {
        controller.abort();
        activeWorkflowControllers.current.delete(prefix);
        recoveredWorkflowPrefixes.current.delete(prefix);
      }
      recoveryControllers.current.clear();
    };
  }, [sources, filterAdult]);

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
      {
        filterAdult,
        readDecodedHeight: (candidate) => {
          if (!candidate.sourceId || !candidate.vodId) return undefined;
          const quality = readQuality(candidate.sourceId, candidate.vodId);
          return quality?.from === "play" ? quality.height : undefined;
        },
      },
    );
    // Reuse the exact server search results; do not issue a duplicate movie search.
    const workflowAdapters = {
      ...adapters,
      search: async () => movieResults.map((item) => ({
        id: `${item.sourceKey}:${item.vodId}`,
        title: item.name,
        year: typeof item.year === "string" ? item.year : undefined,
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
    workflowContexts.current.set(data.searchId, { query: String(data.keyword || "影视搜索").slice(0, 50), taskIdPrefix, adapters: workflowAdapters });
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
        | { assessments?: Array<{ sourceId: string; candidateId?: string; status: "resolution_detected" | "resolution_unknown" | "unavailable" | "unknown"; resolutionHeight: number | null; decodedResolutionHeight: number | null; resolutionSource: "decoded_playback" | "playlist_or_segment" | "unknown"; originTtfbMs: number | null; probeDurationMs: number | null; probeResultCached: boolean | null }> }
        | undefined;
      const reviewOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.review)?.output as
        | { accepted?: boolean; findings?: string[]; candidateCount?: number; assessmentCount?: number; measurementCompleted?: boolean; resolutionMeasured?: boolean }
        | undefined;
      const playbackOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.playback)?.output as
        | { recommendations?: NonNullable<FridayWorkflowView["playbackRecommendations"]> }
        | undefined;
      setWorkflowBySearchId((current) => ({
        ...current,
        [data.searchId!]: {
          status: workflow.results.every((item) => item.status === "succeeded") ? "completed" : "failed",
          retryable: workflow.results.some((item) => item.status === "failed" && item.error?.retryable === true),
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
          playbackRecommendations: playbackOutput?.recommendations ?? [],
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

  // Conversation continuity is browser-local and deliberately excludes tool/data payloads.
  const historyKey = `friday-conversation-v1:${assistantId}`;
  const [loadedHistoryKey, setLoadedHistoryKey] = useState("");
  useEffect(() => {
    let active = true;
    try {
      const stored = window.localStorage.getItem(historyKey);
      const restored = restoreFridayConversationHistory(stored);
      setMessages(restored as typeof messages);
    } catch {
      // Private browsing or storage denial must not prevent chat from working.
    } finally {
      if (active) setLoadedHistoryKey(historyKey);
    }
    return () => { active = false; };
  }, [historyKey, setMessages]);

  useEffect(() => {
    if (loadedHistoryKey !== historyKey) return;
    try {
      window.localStorage.setItem(historyKey, serializeFridayConversationHistory(messages));
    } catch {
      // Quota/storage failures are non-fatal; the current in-memory conversation remains available.
    }
  }, [messages, historyKey, loadedHistoryKey]);

  const retryMovieWorkflow = useCallback(async (searchId: string) => {
    const context = workflowContexts.current.get(searchId);
    if (!context || activeWorkflowControllers.current.has(searchId)) return;
    const controller = new AbortController();
    activeWorkflowControllers.current.set(searchId, controller);
    setWorkflowBySearchId((current) => ({
      ...current,
      [searchId]: { ...current[searchId], status: "running", error: undefined },
    }));
    try {
      const workflow = await runLibreTVMovieWorkflow({
        ...context,
        runtime: fridayTaskRuntime,
        signal: controller.signal,
        replayFailed: true,
      });
      if (!mountedRef.current || !isCurrentFridayWorkflow(controller, activeWorkflowControllers.current.get(searchId))) return;
      activeWorkflowControllers.current.delete(searchId);
      const sourceOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.source)?.output as
        | { probes?: Array<{ sourceId: string; candidateId?: string; title?: string; reachable: boolean }> }
        | undefined;
      const qualityOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.quality)?.output as
        | { assessments?: Array<{ sourceId: string; candidateId?: string; status: "resolution_detected" | "resolution_unknown" | "unavailable" | "unknown"; resolutionHeight: number | null; probeDurationMs: number | null; probeResultCached: boolean | null }> }
        | undefined;
      const reviewOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.review)?.output as
        | { accepted?: boolean; findings?: string[]; candidateCount?: number; assessmentCount?: number; measurementCompleted?: boolean; resolutionMeasured?: boolean }
        | undefined;
      const playbackOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.playback)?.output as
        | { recommendations?: NonNullable<FridayWorkflowView["playbackRecommendations"]> }
        | undefined;
      setWorkflowBySearchId((current) => ({
        ...current,
        [searchId]: {
          status: workflow.results.every((item) => item.status === "succeeded") ? "completed" : "failed",
          retryable: workflow.results.some((item) => item.status === "failed" && item.error?.retryable === true),
          sourceChecks: sourceOutput?.probes ?? [],
          qualityChecks: qualityOutput?.assessments ?? [],
          review: reviewOutput && {
            accepted: reviewOutput.accepted === true,
            findings: reviewOutput.findings ?? [],
            candidateCount: reviewOutput.candidateCount ?? 0,
            assessmentCount: reviewOutput.assessmentCount ?? 0,
            measurementCompleted: reviewOutput.measurementCompleted === true,
            resolutionMeasured: reviewOutput.resolutionMeasured === true,
          },
          playbackRecommendations: playbackOutput?.recommendations ?? [],
        },
      }));
    } catch (retryError) {
      if (!mountedRef.current || !isCurrentFridayWorkflow(controller, activeWorkflowControllers.current.get(searchId))) return;
      activeWorkflowControllers.current.delete(searchId);
      setWorkflowBySearchId((current) => ({
        ...current,
        [searchId]: {
          ...current[searchId],
          status: "failed",
          retryable: false,
          error: retryError instanceof Error ? retryError.message : (language === "en" ? "Retry failed" : "重试失败"),
        },
      }));
    }
  }, [language]);

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
    retryMovieWorkflow,
    restoredTasks,
    clearTaskHistory,
    busy: status === "submitted" || status === "streaming",
  };
}
