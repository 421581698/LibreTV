"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { MessageLike } from "@/components/friday/FridayPanel";
import type { FridaySourceConfig } from "@/components/friday/useFridaySources";
import type { SearchResultItem, SourceConfig } from "@/lib/types";
import { readQuality } from "@/lib/store";
import { createLibreTVMovieAgentAdapters } from "@/lib/friday/libretv-movie-adapters";
import { createMovieWorkflowTaskIdPrefix, recordPlaybackEvidence, runLibreTVMovieWorkflow } from "@/lib/friday/movie-workflow";
import { runFridayDag } from "@/lib/friday/dag-orchestrator";
import { createPlaybackEvidenceAgent } from "@/lib/friday/movie-agents";
import { fridayTaskEventStore, fridayTaskRuntime } from "@/lib/friday/task-service";
import type { TaskDefinition, TaskSnapshot } from "@/lib/friday/task-runtime";
import type { MovieAgentAdapters, MovieCandidate } from "@/lib/friday/movie-agents";
import { isCurrentFridayWorkflow } from "@/components/friday/workflowRequestGuard";
import { applyDecodedPlaybackEvidence, applyPlaybackFeedbackToWorkflow } from "@/lib/friday/playback-feedback";
import { restoreFridayConversationHistory, serializeFridayConversationHistory } from "@/lib/friday/conversation-history";

export type FridayWorkflowView = {
  status: "running" | "completed" | "failed";
  sourceChecks?: Array<{ sourceId: string; candidateId?: string; title?: string; year?: string; reachable: boolean; latencyMs?: number; upstreamRequestMs?: number; upstreamRequestCount?: number; originTtfbMs?: number }>;
  qualityChecks?: Array<{ sourceId: string; candidateId?: string; title?: string; year?: string; playbackSampleCount?: number | null; playbackMinHeight?: number | null; playbackMaxHeight?: number | null; status: "resolution_detected" | "resolution_unknown" | "unavailable" | "unknown"; resolutionHeight: number | null; decodedVideoHeight?: number | null; decodedResolutionHeight?: number | null; sourceResolutionHeight?: number | null; resolutionSource?: "decoded_playback" | "playlist_or_segment" | "unknown"; originTtfbMs?: number | null; probeDurationMs?: number | null; upstreamRequestMs?: number | null; upstreamRequestCount?: number | null; probeResultCached?: boolean | null }>;
  review?: { accepted: boolean; findings: string[]; candidateCount: number; assessmentCount: number; measurementCompleted: boolean; resolutionMeasured: boolean };
  playbackRecommendations?: Array<{
    title: string;
    year?: string;
    candidateId: string;
    sourceId: string;
    resolutionHeight: number | null;
    selectionBasis: "decoded-playback" | "source-probe" | "reachable-only";
    playbackSampleCount?: number | null;
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
  const workflowContexts = useRef(new Map<string, { query: string; taskIdPrefix: string; adapters: MovieAgentAdapters; candidateIds: Set<string> }>());
  const [workflowBySearchId, setWorkflowBySearchId] = useState<Record<string, FridayWorkflowView>>({});
  const decodedPlaybackHeightsRef = useRef(new Map<string, number>());
  const [restoredTasks, setRestoredTasks] = useState<TaskSnapshot[]>([]);

  const clearTaskHistory = useCallback(async () => {
    await fridayTaskEventStore.clearAll();
    setRestoredTasks([]);
  }, []);

  // Decoded videoHeight feeds the visible workflow and is also persisted as a child DAG task.
  useEffect(() => {
    const handlePlaybackQuality = (event: Event) => {
      const detail = (event as CustomEvent<{
        candidateId?: unknown;
        sourceKey?: unknown;
        vodId?: unknown;
        height?: unknown;
        playbackSampleCount?: unknown;
        playbackMinHeight?: unknown;
        playbackMaxHeight?: unknown;
        observedAt?: unknown;
      }>).detail;
      if (typeof detail?.candidateId !== "string" || !detail.candidateId.trim()) return;
      if (typeof detail.sourceKey !== "string" || !detail.sourceKey.trim()) return;
      if (typeof detail.vodId !== "string" || !detail.vodId.trim()) return;
      if (typeof detail.height !== "number" || !Number.isFinite(detail.height)) return;
      const height = Math.floor(detail.height);
      if (height < 1 || height > 16384) return;
      const sampleCount = typeof detail.playbackSampleCount === "number" &&
        Number.isInteger(detail.playbackSampleCount) && detail.playbackSampleCount > 0
        ? detail.playbackSampleCount : undefined;
      const minHeight = typeof detail.playbackMinHeight === "number" ? detail.playbackMinHeight : height;
      const maxHeight = typeof detail.playbackMaxHeight === "number" ? detail.playbackMaxHeight : height;
      const observedAt = typeof detail.observedAt === "string" && Number.isFinite(Date.parse(detail.observedAt))
        ? detail.observedAt : new Date().toISOString();
      decodedPlaybackHeightsRef.current.set(detail.candidateId, height);

      const parentContext = [...workflowContexts.current.values()].reverse()
        .find((context) => context.candidateIds.has(detail.candidateId as string));
      void recordPlaybackEvidence({
        evidence: {
          candidateId: detail.candidateId,
          sourceId: detail.sourceKey,
          vodId: detail.vodId,
          decodedHeight: height,
          observedAt,
          sampleCount,
          minHeight,
          maxHeight,
        },
        runtime: fridayTaskRuntime,
        parentTaskId: parentContext ? `${parentContext.taskIdPrefix}.playback` : undefined,
      }).then(async () => {
        try {
          setRestoredTasks(await fridayTaskRuntime.restoreAll());
        } catch (restoreError) {
          console.error("[Friday] Could not refresh playback evidence audit:", restoreError);
        }
      }).catch((feedbackError) => {
        console.error("[Friday] Could not persist playback evidence:", feedbackError);
      });

      setWorkflowBySearchId((current) => Object.fromEntries(
        Object.entries(current).map(([searchId, workflow]) => [
          searchId,
          applyPlaybackFeedbackToWorkflow(workflow, {
            candidateId: detail.candidateId as string,
            sourceKey: detail.sourceKey as string,
            vodId: detail.vodId as string,
            height,
            playbackSampleCount: sampleCount,
            playbackMinHeight: minHeight,
            playbackMaxHeight: maxHeight,
            observedAt,
          }),
        ]),
      ));
    };
    window.addEventListener("friday-player-quality", handlePlaybackQuality);
    return () => window.removeEventListener("friday-player-quality", handlePlaybackQuality);
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
      {
        filterAdult,
        readPlaybackEvidence: (candidate) => {
          if (!candidate.sourceId || !candidate.vodId) return undefined;
          const quality = readQuality(candidate.sourceId, candidate.vodId);
          return quality?.from === "play" ? quality : undefined;
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
    window.dispatchEvent(new CustomEvent("friday-home-runtime-state", {
      detail: { agent: "executing" },
    }));

    const taskIdPrefix = createMovieWorkflowTaskIdPrefix();
    workflowContexts.current.set(data.searchId, { query: String(data.keyword || "影视搜索").slice(0, 50), taskIdPrefix, adapters: workflowAdapters, candidateIds: new Set(movieResults.map((item) => `${item.sourceKey}:${item.vodId}`)) });
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
      window.dispatchEvent(new CustomEvent("friday-home-runtime-state", {
        detail: { agent: "rendering" },
      }));
      activeWorkflowControllers.current.delete(data.searchId!);
      const sourceOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.source)?.output as
        | { probes?: Array<{ sourceId: string; candidateId?: string; title?: string; year?: string; reachable: boolean; upstreamRequestMs?: number; upstreamRequestCount?: number; originTtfbMs?: number }> }
        | undefined;
      const qualityOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.quality)?.output as
        | { assessments?: Array<{ sourceId: string; candidateId?: string; title?: string; year?: string; status: "resolution_detected" | "resolution_unknown" | "unavailable" | "unknown"; resolutionHeight: number | null; decodedResolutionHeight: number | null; playbackSampleCount?: number | null; playbackMinHeight?: number | null; playbackMaxHeight?: number | null; lastPlaybackHeight?: number | null; sourceResolutionHeight: number | null; resolutionSource: "decoded_playback" | "playlist_or_segment" | "unknown"; originTtfbMs: number | null; probeDurationMs: number | null; upstreamRequestMs: number | null; upstreamRequestCount: number | null; probeResultCached: boolean | null }> }
        | undefined;
      const reviewOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.review)?.output as
        | { accepted?: boolean; findings?: string[]; candidateCount?: number; assessmentCount?: number; measurementCompleted?: boolean; resolutionMeasured?: boolean }
        | undefined;
      const playbackOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.playback)?.output as
        | { recommendations?: NonNullable<FridayWorkflowView["playbackRecommendations"]> }
        | undefined;
      const workflowSucceeded = workflow.results.every((item) => item.status === "succeeded");
      setWorkflowBySearchId((current) => ({
        ...current,
        [data.searchId!]: {
          status: workflowSucceeded ? "completed" : "failed",
          retryable: workflow.results.some((item) => item.status === "failed" && item.error?.retryable === true),
          sourceChecks: sourceOutput?.probes ?? [],
          qualityChecks: (qualityOutput?.assessments ?? []).map((item) => {
            const decodedHeight = item.candidateId ? decodedPlaybackHeightsRef.current.get(item.candidateId) : undefined;
            return decodedHeight ? { ...item, status: "resolution_detected" as const, resolutionHeight: decodedHeight, decodedResolutionHeight: decodedHeight, decodedVideoHeight: decodedHeight, resolutionSource: "decoded_playback" as const } : { ...item, decodedVideoHeight: null };
          }),
          review: reviewOutput && {
            accepted: reviewOutput.accepted === true,
            findings: reviewOutput.findings ?? [],
            candidateCount: reviewOutput.candidateCount ?? movieResults.length,
            assessmentCount: reviewOutput.assessmentCount ?? 0,
            measurementCompleted: reviewOutput.measurementCompleted === true,
            resolutionMeasured: reviewOutput.resolutionMeasured === true,
          },
          playbackRecommendations: applyDecodedPlaybackEvidence(
            playbackOutput?.recommendations ?? [],
            (qualityOutput?.assessments ?? []).map((item) => {
              const decodedHeight = item.candidateId ? decodedPlaybackHeightsRef.current.get(item.candidateId) : undefined;
              return decodedHeight ? { ...item, status: "resolution_detected" as const, resolutionHeight: decodedHeight, decodedResolutionHeight: decodedHeight, decodedVideoHeight: decodedHeight, resolutionSource: "decoded_playback" as const } : { ...item, decodedVideoHeight: null };
            }),
            sourceOutput?.probes ?? [],
          ),
        },
      }));
      window.dispatchEvent(new CustomEvent("friday-home-runtime-state", {
        detail: { agent: workflowSucceeded ? "completed" : "error" },
      }));
    }).catch((error) => {
      // Abort is an expected lifecycle event, not a failed workflow to display to the user.
      if (!mountedRef.current || !isCurrentFridayWorkflow(controller, activeWorkflowControllers.current.get(data.searchId!))) return;
      activeWorkflowControllers.current.delete(data.searchId!);
      window.dispatchEvent(new CustomEvent("friday-home-runtime-state", {
        detail: { agent: "error" },
      }));
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
        | { probes?: Array<{ sourceId: string; candidateId?: string; title?: string; reachable: boolean; upstreamRequestMs?: number; upstreamRequestCount?: number; originTtfbMs?: number }> }
        | undefined;
      const qualityOutput = workflow.results.find((item) => item.taskId === workflow.taskIds.quality)?.output as
        | { assessments?: Array<{ sourceId: string; candidateId?: string; title?: string; year?: string; status: "resolution_detected" | "resolution_unknown" | "unavailable" | "unknown"; resolutionHeight: number | null; decodedResolutionHeight: number | null; playbackSampleCount?: number | null; playbackMinHeight?: number | null; playbackMaxHeight?: number | null; lastPlaybackHeight?: number | null; sourceResolutionHeight: number | null; resolutionSource: "decoded_playback" | "playlist_or_segment" | "unknown"; originTtfbMs: number | null; probeDurationMs: number | null; upstreamRequestMs: number | null; upstreamRequestCount: number | null; probeResultCached: boolean | null }> }
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
          qualityChecks: (qualityOutput?.assessments ?? []).map((item) => {
            const decodedHeight = item.candidateId ? decodedPlaybackHeightsRef.current.get(item.candidateId) : undefined;
            return decodedHeight ? { ...item, status: "resolution_detected" as const, resolutionHeight: decodedHeight, decodedResolutionHeight: decodedHeight, decodedVideoHeight: decodedHeight, resolutionSource: "decoded_playback" as const } : { ...item, decodedVideoHeight: null };
          }),
          review: reviewOutput && {
            accepted: reviewOutput.accepted === true,
            findings: reviewOutput.findings ?? [],
            candidateCount: reviewOutput.candidateCount ?? 0,
            assessmentCount: reviewOutput.assessmentCount ?? 0,
            measurementCompleted: reviewOutput.measurementCompleted === true,
            resolutionMeasured: reviewOutput.resolutionMeasured === true,
          },
          playbackRecommendations: applyDecodedPlaybackEvidence(
            playbackOutput?.recommendations ?? [],
            (qualityOutput?.assessments ?? []).map((item) => {
              const decodedHeight = item.candidateId ? decodedPlaybackHeightsRef.current.get(item.candidateId) : undefined;
              return decodedHeight ? { ...item, status: "resolution_detected" as const, resolutionHeight: decodedHeight, decodedResolutionHeight: decodedHeight, decodedVideoHeight: decodedHeight, resolutionSource: "decoded_playback" as const } : { ...item, decodedVideoHeight: null };
            }),
            sourceOutput?.probes ?? [],
          ),
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

  const retryInterruptedWorkflow = useCallback(async (taskId: string) => {
    // Playback observations are independent, read-only audit tasks rather than
    // part of the five-stage movie workflow. Resume them from their own durable
    // definition/checkpoint instead of deriving a movie-workflow prefix.
    if (taskId.endsWith(".playback-evidence")) {
      const events = await fridayTaskEventStore.read(taskId);
      const created = events.find((event) => event.type === "task.created");
      const definition = (created?.payload as { definition?: TaskDefinition } | undefined)?.definition;
      if (!definition || definition.taskId !== taskId || definition.agent !== "playback-evidence-agent") {
        console.error("[Friday] Cannot recover playback evidence: persisted task definition is unavailable.");
        return;
      }
      try {
        await runFridayDag({
          tasks: [definition],
          agents: [createPlaybackEvidenceAgent()],
          runtime: fridayTaskRuntime,
          replayFailed: true,
        });
      } catch (recoveryError) {
        console.error("[Friday] Explicit playback-evidence recovery failed:", recoveryError);
      } finally {
        try {
          setRestoredTasks(await fridayTaskRuntime.restoreAll());
        } catch (restoreError) {
          console.error("[Friday] Could not refresh recovered playback evidence:", restoreError);
        }
      }
      return;
    }

    const suffix = /\.(search|source|quality|review|playback)$/;
    if (!suffix.test(taskId)) return;
    const taskIdPrefix = taskId.replace(suffix, "");
    const workflowTasks = restoredTasks.filter((task) => task.taskId.startsWith(`${taskIdPrefix}.`));
    let searchTask = workflowTasks.find((task) => task.taskId === `${taskIdPrefix}.search`);
    if (!searchTask) {
      // The task may fall outside the 50-item history summary. Read its complete
      // event stream directly so a newer interrupted child can still be resumed.
      const searchEvents = await fridayTaskEventStore.read(`${taskIdPrefix}.search`);
      const created = searchEvents.find((event) => event.type === "task.created");
      const definition = (created?.payload as { definition?: TaskDefinition } | undefined)?.definition;
      if (definition) searchTask = await fridayTaskRuntime.getSnapshot(definition);
    }
    if (!searchTask) {
      console.error("[Friday] Cannot recover workflow: persisted search task is missing from local history.");
      return;
    }
    const query = (searchTask.input as { query?: unknown })?.query;
    if (typeof query !== "string" || !query.trim()) {
      console.error("[Friday] Cannot recover workflow: persisted search query is unavailable.");
      return;
    }

    const baseAdapters = createLibreTVMovieAgentAdapters(sources as SourceConfig[], {
      filterAdult,
      readPlaybackEvidence: (candidate) => {
        if (!candidate.sourceId || !candidate.vodId) return undefined;
        const quality = readQuality(candidate.sourceId, candidate.vodId);
        return quality?.from === "play" ? quality : undefined;
      },
    });
    const storedCandidates = (searchTask.output as { candidates?: unknown } | undefined)?.candidates;
    const adapters: MovieAgentAdapters = searchTask.status === "succeeded" && Array.isArray(storedCandidates)
      ? {
          ...baseAdapters,
          search: async () => storedCandidates as MovieCandidate[],
        }
      : baseAdapters;

    try {
      await runLibreTVMovieWorkflow({
        query,
        taskIdPrefix,
        adapters,
        runtime: fridayTaskRuntime,
        replayFailed: true,
      });
    } catch (recoveryError) {
      console.error("[Friday] Explicit interrupted-workflow recovery failed:", recoveryError);
    } finally {
      try {
        setRestoredTasks(await fridayTaskRuntime.restoreAll());
      } catch (restoreError) {
        console.error("[Friday] Could not refresh recovered task history:", restoreError);
      }
    }
  }, [restoredTasks, sources, filterAdult]);

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
    retryInterruptedWorkflow,
    restoredTasks,
    clearTaskHistory,
    busy: status === "submitted" || status === "streaming",
  };
}
