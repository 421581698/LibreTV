
"use client";

import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FridayStyles } from "@/components/friday/FridayStyles";
import { fridayReducer, initialFridayState } from "@/lib/friday/state";
import FridayOrb from "@/components/friday/FridayOrb";
import { FridayPanel, getPartText, getMovieDataForMessage } from "@/components/friday/FridayPanel";
import type { MovieItem } from "@/components/friday/FridayPanel";
import { useFridayVoiceController } from "@/components/friday/useFridayVoiceController";
import { useFridayFabController } from "@/components/friday/useFridayFabController";
import { useFridayResponseController } from "@/components/friday/useFridayResponseController";
import { useFridayRequestLifecycle } from "@/components/friday/useFridayRequestLifecycle";
import { useFridayPanelEvents } from "@/components/friday/useFridayPanelEvents";
import { useFridayMovieTransition } from "@/components/friday/useFridayMovieTransition";

import { useFridaySources, type FridaySourceConfig } from "@/components/friday/useFridaySources";
import { useFridayChatSession } from "@/components/friday/useFridayChatSession";
import type { FridayAssistantId } from "@/lib/friday/assistant-profiles";



type FridayProps = {
  sources?: FridaySourceConfig[];
  filterAdult?: boolean;
  showFab?: boolean;
  /** Homepage V2 keeps the orchestrator for voice/chat but never mounts the legacy popup. */
  inlineMode?: boolean;
};

type AuroraState =
  | "standby"
  | "listening"
  | "thinking"
  | "speaking"
  | "completed";

const MAX_INPUT_LENGTH = 1000;

export default function AIFloatingBall({
  sources,
  filterAdult,
  showFab = true,
  inlineMode = false,
}: FridayProps) {
  const [machineState, dispatchMachine] = useReducer(
    fridayReducer,
    initialFridayState,
  );


  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [assistantId, setAssistantId] = useState<FridayAssistantId>("friday");
  const [voiceStyle, setVoiceStyle] = useState<"auto" | "jarvis" | "warm" | "clear">("auto");
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [languagePreferenceLoaded, setLanguagePreferenceLoaded] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [playerActive, setPlayerActive] = useState(false);

  // Read after hydration to avoid server/client markup mismatch, then persist
  // only after the stored preference has been applied.
  useEffect(() => {
    try {
      const savedLanguage = window.localStorage.getItem("friday-language");
      const savedAssistant = window.localStorage.getItem("friday-assistant");
      const savedWakeWord = window.localStorage.getItem("friday-wake-word");
      const savedVoiceStyle = window.localStorage.getItem("friday-voice-style");
      if (savedVoiceStyle === "auto" || savedVoiceStyle === "jarvis" || savedVoiceStyle === "warm" || savedVoiceStyle === "clear") setVoiceStyle(savedVoiceStyle);
      if (savedAssistant === "friday" || savedAssistant === "jarvis" || savedAssistant === "lin-meimei") {
        setAssistantId(savedAssistant);
      }
      if (savedWakeWord === "true") setWakeWordEnabled(true);
      if (savedLanguage === "zh" || savedLanguage === "en") {
        setLanguage(savedLanguage);
      }
    } catch {
      // Storage may be unavailable in private browsing; keep the default.
    } finally {
      setLanguagePreferenceLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!languagePreferenceLoaded) return;
    try {
      window.localStorage.setItem("friday-language", language);
    } catch {
      // Language switching remains available for this session.
    }
  }, [language, languagePreferenceLoaded]);

  useEffect(() => {
    if (!languagePreferenceLoaded) return;
    try {
      window.localStorage.setItem("friday-wake-word", String(wakeWordEnabled));
    } catch {
      // Wake phrase preference remains available for this session.
    }
  }, [wakeWordEnabled, languagePreferenceLoaded]);

  useEffect(() => {
    if (!languagePreferenceLoaded) return;
    try {
      window.localStorage.setItem("friday-assistant", assistantId);
    } catch {
      // Profile selection remains available for this session.
    }
  }, [assistantId, languagePreferenceLoaded]);

  useEffect(() => {
    const handleLanguagePreferenceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ language?: string }>).detail;
      if (detail?.language === "zh" || detail?.language === "en") setLanguage(detail.language);
    };
    window.addEventListener("friday-language-preference-change", handleLanguagePreferenceChange);
    return () => window.removeEventListener("friday-language-preference-change", handleLanguagePreferenceChange);
  }, []);

  useEffect(() => {
    const handleVoicePreferenceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ voiceStyle?: string }>).detail;
      if (detail?.voiceStyle === "auto" || detail?.voiceStyle === "jarvis" || detail?.voiceStyle === "warm" || detail?.voiceStyle === "clear") {
        setVoiceStyle(detail.voiceStyle);
      }
    };
    window.addEventListener("friday-voice-preference-change", handleVoicePreferenceChange);
    return () => window.removeEventListener("friday-voice-preference-change", handleVoicePreferenceChange);
  }, []);

  const openRef = useRef(false);
  const closingRef = useRef(false);
  const busyRef = useRef(false);

  const handleSendRef = useRef<
    (text?: string, keepVoiceSession?: boolean) => Promise<void>
  >(async () => {});

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const homeWakeTokenRef = useRef(0);
  const homeWakeAudioRef = useRef<HTMLAudioElement | null>(null);
  const homeWakeUrlRef = useRef("");


  const {
    listening, voiceEnabled, speaking, completed, voiceError, voiceSessionActive,
    voiceSessionActiveRef, startListening, scheduleVoiceResume, setSpeaking,
    clearVoiceResumeTimer, setVoiceSession, stopRecognition, stopSpeech,
    stopAllVoice, speakText, toggleVoiceEnabled,
    stopSpeechAndResume, toggleListening, setVoiceError, setCompleted,
    lastSpokenMessageRef,
  } = useFridayVoiceController({
    busyRef, openRef, closingRef, dispatchMachine, setInput, handleSendRef, language, assistantId, voiceStyle, wakeWordEnabled,
    onAudioLevel: (level) => {
      setAudioLevel(level);
      window.dispatchEvent(new CustomEvent('friday-audio-level', { detail: { level } }));
    },
  });

  useEffect(() => {
    const handlePlayerState = (event: Event) => {
      const active = (event as CustomEvent<{ active?: boolean }>).detail?.active;
      setPlayerActive(active === true);
    };
    window.addEventListener("friday-player-state", handlePlayerState);
    return () => window.removeEventListener("friday-player-state", handlePlayerState);
  }, []);

  const { activeSources, activeFilterAdult } = useFridaySources(sources, filterAdult);

  const {
    typedMessages,
    sendMessage,
    status,
    error,
    stop,
    setMessages,
    workflowBySearchId,
    retryMovieWorkflow,
    restoredTasks,
    clearTaskHistory,
    busy,
  } = useFridayChatSession({
    sources: activeSources,
    filterAdult: activeFilterAdult,
    language,
    assistantId,
    playerActive,
  });

  const { beginRequest, failActiveRequest, cancelActiveRequest } =
    useFridayRequestLifecycle({ busy, error, dispatchMachine });

  // 同步引用，避免回调读取到上一轮渲染的状态。
  busyRef.current = busy;
  closingRef.current = closing;

  const {
    clearMovieCloseTimer,
    resetPendingMovie,
    handleOpenMovie,
    handlePanelAnimationEnd,
  } = useFridayMovieTransition<MovieItem>({
    openRef,
    closingRef,
    busyRef,
    setClosing,
    setOpen,
    setExpanded,
    stopAllVoice,
    stop,
  });

  // The VAD interrupt controller owns its microphone only during TTS playback;
  // its RMS callback drives the orb meter without opening a competing ASR stream.
  const auroraState: AuroraState = speaking
    ? "speaking"
    : listening
      ? "listening"
      : busy
        ? "thinking"
        : completed
          ? "completed"
          : "standby";

  const fridayOrbState = auroraState === "listening" ? "LISTENING"
    : auroraState === "thinking" ? "THINKING"
    : auroraState === "speaking" ? "SPEAKING" : "IDLE";

  useEffect(() => {
    if (auroraState !== "speaking") setAudioLevel(0);
  }, [auroraState]);

  useEffect(() => {
    const state = auroraState === "listening" ? "LISTENING"
      : auroraState === "thinking" ? "THINKING"
      : auroraState === "speaking" ? "SPEAKING" : "IDLE";
    window.dispatchEvent(new CustomEvent("friday-home-voice-state", { detail: { state } }));
  }, [auroraState]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("friday-home-voice-error", { detail: { message: voiceError } }));
  }, [voiceError]);


  const stateLabel = language === "en"
    ? voiceError ? "Voice unavailable — retry or type a message"
      : auroraState === "listening" ? "Listening"
      : auroraState === "thinking" ? "Finding the right titles"
      : auroraState === "speaking" ? "Friday is responding"
      : auroraState === "completed" ? "Completed" : "Ready when you are"
    : voiceError ? "语音暂不可用，可重试或使用文字输入"
      : auroraState === "listening" ? "正在聆听"
      : auroraState === "thinking" ? "正在寻找合适的影视资源"
      : auroraState === "speaking" ? "Friday 正在回复"
      : auroraState === "completed" ? "已完成" : "随时为你服务";

  const openPanel = useCallback(() => {
    resetPendingMovie();
    clearVoiceResumeTimer();

    closingRef.current = false;
    openRef.current = true;

    setClosing(false);
    setOpen(true);
    dispatchMachine({ type: "OPEN" });
    setExpanded(false);
    setImmersive(false);
    setVoiceError("");
  }, [resetPendingMovie, clearVoiceResumeTimer, setVoiceError]);

  const openAndListen = useCallback(() => {
    openPanel();

    // 先同步更新引用，再启动识别。
    openRef.current = true;
    closingRef.current = false;

    setVoiceSession(true);

    // 保留真实用户点击手势。
    startListening(false);
  }, [openPanel, startListening]);

  const openImmersiveAndListen = useCallback(() => {
    openPanel();
    openRef.current = true;
    closingRef.current = false;
    setImmersive(true);
    setExpanded(true);
    setVoiceSession(true);
    // 保留真实用户点击手势，直接启动现有语音识别器。
    startListening(false);
  }, [openPanel, startListening, setVoiceSession]);

  // 首页圆球每次点击都执行同一条 Neural TTS 唤醒链路。
  // 若上一轮正在聆听/播报，先彻底释放旧会话，再播放唤醒音并重新启动识别。
  useEffect(() => {
    const handleHomeOrbToggle = () => {
      const wakeToken = ++homeWakeTokenRef.current;

      const previousAudio = homeWakeAudioRef.current;
      homeWakeAudioRef.current = null;
      if (previousAudio) {
        previousAudio.onended = null;
        previousAudio.onerror = null;
        previousAudio.pause();
        previousAudio.removeAttribute("src");
        previousAudio.load();
      }
      if (homeWakeUrlRef.current) {
        URL.revokeObjectURL(homeWakeUrlRef.current);
        homeWakeUrlRef.current = "";
      }

      openPanel();
      openRef.current = true;
      closingRef.current = false;
      clearVoiceResumeTimer();

      // 统一中断旧识别、旧回复和旧请求；第二次及后续点击不再走“只关闭聆听”的分支。
      stopRecognition(true);
      stopSpeech();
      stop();
      cancelActiveRequest();
      window.speechSynthesis?.cancel();
      setVoiceSession(true);
      setVoiceError("");
      setSpeaking(true);

      const finishWake = (message?: string) => {
        if (wakeToken !== homeWakeTokenRef.current) return;
        const activeAudio = homeWakeAudioRef.current;
        homeWakeAudioRef.current = null;
        if (activeAudio) {
          activeAudio.onended = null;
          activeAudio.onerror = null;
          activeAudio.pause();
          activeAudio.removeAttribute("src");
          activeAudio.load();
        }
        if (homeWakeUrlRef.current) {
          URL.revokeObjectURL(homeWakeUrlRef.current);
          homeWakeUrlRef.current = "";
        }
        setSpeaking(false);
        if (message) setVoiceError(message);
        // Safari 可能仍在释放上一识别实例；startListening 会排队等待 onend。
        startListening(false);
      };

      void (async () => {
        try {
          const response = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
              text: language === "en" ? "I am here, sir." : "我在，先生",
              language,
              assistantId,
              voiceStyle,
            }),
          });
          if (!response.ok) throw new Error(`TTS request failed: ${response.status}`);
          const contentType = (response.headers.get("content-type") || "").toLowerCase();
          if (!contentType.includes("audio/mpeg") && !contentType.includes("audio/wav")) {
            throw new Error("Unsupported TTS audio format");
          }
          const blob = await response.blob();
          if (!blob.size) throw new Error("Empty TTS audio");
          if (wakeToken !== homeWakeTokenRef.current) return;

          const wakeUrl = URL.createObjectURL(blob);
          homeWakeUrlRef.current = wakeUrl;
          const wakeAudio = new Audio(wakeUrl);
          homeWakeAudioRef.current = wakeAudio;
          wakeAudio.onended = () => finishWake();
          wakeAudio.onerror = () => finishWake("Jarvis 语音播放失败，请检查网络或 TTS 服务。");
          await wakeAudio.play();
        } catch (error) {
          if (wakeToken !== homeWakeTokenRef.current) return;
          console.error("[Friday] Wake acknowledgement TTS failed:", error);
          finishWake("Jarvis 语音服务暂时不可用，已启动麦克风；不会回退到 Siri 系统声音。");
        }
      })();
    };

    window.addEventListener("friday-home-orb-toggle", handleHomeOrbToggle);
    return () => {
      window.removeEventListener("friday-home-orb-toggle", handleHomeOrbToggle);
      // A pending wake acknowledgement is outside the voice controller's TTS
      // handle. Invalidate its async continuation and release its audio URL on
      // unmount so a late fetch cannot leave audio or blob resources behind.
      homeWakeTokenRef.current += 1;
      const wakeAudio = homeWakeAudioRef.current;
      homeWakeAudioRef.current = null;
      if (wakeAudio) {
        wakeAudio.onended = null;
        wakeAudio.onerror = null;
        wakeAudio.pause();
        wakeAudio.removeAttribute("src");
        wakeAudio.load();
      }
      if (homeWakeUrlRef.current) {
        URL.revokeObjectURL(homeWakeUrlRef.current);
        homeWakeUrlRef.current = "";
      }
    };
  }, [
    openPanel,
    clearVoiceResumeTimer,
    stopRecognition,
    stopSpeech,
    stop,
    cancelActiveRequest,
    setVoiceSession,
    setVoiceError,
    setSpeaking,
    startListening,
    language,
    assistantId,
    voiceStyle,
  ]);

  const handleSend = useCallback(
    async (text?: string, keepVoiceSession = false) => {
      const content = (text ?? input).trim();

      if (!content || busyRef.current || closingRef.current) return;
      if (content.length > MAX_INPUT_LENGTH) return;

      if (keepVoiceSession) {
        clearVoiceResumeTimer();
        stopRecognition(true);
        stopSpeech();
      } else {
        stopAllVoice();
      }

      setVoiceError("");
      setCompleted(false);
      // Inline homepage mode keeps the recognized phrase visible in the home search field.
      if (!inlineMode) setInput("");

      const requestId = beginRequest();
      // Lock synchronously before the AI SDK status render to serialize ASR/VAD/manual sends.
      busyRef.current = true;

      if (inputRef.current) {
        inputRef.current.style.height = "auto";
      }

      try {
        await sendMessage({ text: content });
      } catch (sendError) {
        console.error("[Friday] Send failed:", sendError);

        failActiveRequest(requestId, "send-failed", "消息发送失败，请检查网络后重试。");
        setVoiceError("消息发送失败，请检查网络后重试。");

        if (keepVoiceSession && voiceSessionActiveRef.current) {
          setVoiceSession(false);
        }
      }
    },
    [
      input,
      inlineMode,
      sendMessage,
      beginRequest,
      failActiveRequest,
      clearVoiceResumeTimer,
      stopRecognition,
      stopSpeech,
      stopAllVoice,
      setVoiceSession,
    ],
  );

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  useEffect(() => {
    const handleHomepageVoiceSubmit = (event: Event) => {
      const text = (
        event as CustomEvent<{ text?: string }>
      ).detail?.text?.trim();
      if (!text) return;

      // 首页麦克风的识别结果直接进入 Friday 对话/影视解析流程。
      openPanel();
      window.setTimeout(() => {
        void handleSendRef.current(text);
      }, 0);
    };

    window.addEventListener("friday-submit-message", handleHomepageVoiceSubmit);
    return () => {
      window.removeEventListener("friday-submit-message", handleHomepageVoiceSubmit);
    };
  }, [openPanel]);

  useEffect(() => {
    if (!immersive) return;
    const wasAlreadyLocked = document.body.classList.contains("friday-popup-lock");
    document.body.classList.add("friday-popup-lock");
    return () => {
      if (!wasAlreadyLocked) {
        document.body.classList.remove("friday-popup-lock");
      }
    };
  }, [immersive]);

  const closePanel = useCallback(() => {
    resetPendingMovie();

    openRef.current = false;
    closingRef.current = false;

    stopAllVoice();

    // stop/cancel unconditionally: the request may have been submitted
    // before the AI SDK's busy status reaches this render.
    stop();
    cancelActiveRequest();

    setClosing(false);
    setOpen(false);
    dispatchMachine({ type: "CLOSE" });
    setExpanded(false);
    setImmersive(false);
  }, [resetPendingMovie, stopAllVoice, stop, cancelActiveRequest]);

  const {
    fabHidden,
    fabPosition,
    handleFabPointerDown,
    handleFabPointerMove,
    handleFabPointerUp,
    handleFabPointerCancel,
    handleFabClick,
    hideAssistant,
    restoreAssistant,
  } = useFridayFabController({
    openRef,
    closingRef,
    onOpen: openAndListen,
    onClose: closePanel,
  });

  const interrupt = useCallback(() => {
    stopAllVoice();
    // Do not rely on busyRef here: it can lag the synchronous submit event.
    stop();
    cancelActiveRequest();
  }, [stopAllVoice, stop, cancelActiveRequest]);

  useFridayResponseController({
    messages: typedMessages,
    status,
    open,
    error,
    voiceEnabled,
    completed,
    voiceSessionActiveRef,
    lastSpokenMessageRef,
    speakText,
    scheduleVoiceResume,
    setSpeaking,
    setCompleted,
    setVoiceError,
  });

  useEffect(() => {
    if (!open) return;

    const container = messagesRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [typedMessages, busy, error, open]);

  useEffect(() => {
    setMounted(true);

    if (window.__FRIDAY_PENDING_OPEN__) {
      window.__FRIDAY_PENDING_OPEN__ = false;
      openPanel();
    }

    return () => {
      openRef.current = false;
      closingRef.current = false;

      clearMovieCloseTimer();

    };
  }, [clearMovieCloseTimer, openPanel]);

  const clearConversation = useCallback(() => {
    interrupt();

    setMessages([]);
    lastSpokenMessageRef.current = "";

    setCompleted(false);
    setVoiceError("");
    setInput("");

    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [interrupt, setMessages]);

  useFridayPanelEvents({
    open,
    closePanel,
    clearConversation,
    openAndListen,
    openImmersiveAndListen,
    openPanel,
  });

  const resizeTextarea = useCallback(() => {
    const element = inputRef.current;
    if (!element) return;

    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 110)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  // V2 homepage runs the shared voice/chat controller without mounting any legacy portal,
  // floating FAB, panel shell, backdrop, or panel CSS.
  if (!mounted || inlineMode) return null;

  const content = (
    <>
      <FridayStyles />

      <div className="friday-root">
        {showFab && !open && !closing && !fabHidden ? (
          <button
            type="button"
            className="friday-fab"
            aria-label="打开 Friday 并开始语音聆听"
            style={
              fabPosition
                ? {
                    position: "fixed",
                    left: fabPosition.left,
                    top: fabPosition.top,
                    right: "auto",
                    bottom: "auto",
                  }
                : undefined
            }
            onPointerDown={handleFabPointerDown}
            onClick={handleFabClick}
          >
            <FridayOrb state={fridayOrbState} audioLevel={audioLevel} theme="auto" />
          </button>
        ) : null}

        {!inlineMode && (open || closing) ? (
          <FridayPanel
            expanded={expanded}
            immersive={immersive}
            closing={closing}
            auroraState={auroraState}
            audioLevel={audioLevel}
            agentState={machineState.agent}
            voiceState={machineState.voice}
            stateLabel={stateLabel}
            onAnimationEnd={handlePanelAnimationEnd}
            onClose={closePanel}
            messagesRef={messagesRef}
            messages={typedMessages}
            workflowBySearchId={workflowBySearchId}
            onRetryWorkflow={(searchId) => { void retryMovieWorkflow(searchId); }}
            restoredTasks={restoredTasks}
            listening={listening}
            busy={busy}
            status={status}
            error={error}
            speaking={speaking}
            completed={completed}
            voiceSessionActive={voiceSessionActive}
            inputRef={inputRef}
            input={input}
            setInput={setInput}
            onSend={() => { void handleSend(); }}
            onToggleListening={toggleListening}
            voiceError={voiceError}
            voiceEnabled={voiceEnabled}
            onToggleVoiceEnabled={toggleVoiceEnabled}
            onClearConversation={clearConversation}
            onStopSpeechAndResume={stopSpeechAndResume}
            onInterrupt={interrupt}
            onToggleExpanded={() => setExpanded((value) => !value)}
            onHideAssistant={hideAssistant}
            onOpenMovie={handleOpenMovie}
            language={language}
            onLanguageChange={setLanguage}
            assistantId={assistantId}
            onAssistantChange={setAssistantId}
            wakeWordEnabled={wakeWordEnabled}
            onWakeWordChange={setWakeWordEnabled}
            onRevokeSession={clearConversation}
            onClearTaskHistory={() => { void clearTaskHistory(); }}
          />
        ) : null}
      {showFab && fabHidden && !open ? (
        <button
          type="button"
          className="friday-restore"
          aria-label="恢复 Friday 助手"
          title="恢复 Friday"
          onClick={restoreAssistant}
        >
          <FridayOrb state="IDLE" theme="auto" interactive={false} />
        </button>
      ) : null}
      </div>
    </>
  );

  return createPortal(content, document.body);
}
