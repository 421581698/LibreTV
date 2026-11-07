"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { FridayEvent } from "@/lib/friday/types";
import { createFridayTtsProvider, type TtsPlaybackHandle } from "@/components/friday/browserTts";
import { getBrowserAsrConstructor, type SpeechRecognitionLike } from "@/components/friday/browserAsr";
import { createVoiceActivityInterruptController, type VoiceActivityInterruptController } from "@/components/friday/voiceActivityInterrupt";

type Options = {
  busyRef: MutableRefObject<boolean>;
  openRef: MutableRefObject<boolean>;
  closingRef: MutableRefObject<boolean>;
  dispatchMachine: Dispatch<FridayEvent>;
  setInput: Dispatch<SetStateAction<string>>;
  handleSendRef: MutableRefObject<
    (text?: string, keepVoiceSession?: boolean) => Promise<void>
  >;
  language: "zh" | "en";
  assistantId: "friday" | "jarvis" | "lin-meimei";
  wakeWordEnabled: boolean;
  onAudioLevel?: (level: number) => void;
};

const MAX_INPUT_LENGTH = 1000;
const VOICE_RESUME_DELAY = 700;

export function shouldEndVoiceSession(error?: string): boolean {
  return Boolean(error && error !== "aborted" && error !== "no-speech");
}

export function getSpeechErrorMessage(error?: string, language: "zh" | "en" = "zh"): string {
  if (language === "en") {
    switch (error) {
      case "not-allowed":
      case "service-not-allowed":
        return "Microphone access was denied. Allow microphone access in your browser settings.";
      case "audio-capture":
        return "No microphone was detected. Check your device settings.";
      case "network":
        return "Speech recognition network error. Check your connection and try again.";
      case "no-speech":
        return "No speech detected. Tap the microphone to try again.";
      case "language-not-supported":
        return "English speech recognition is not supported by this browser. Please type instead.";
      case "aborted":
        return "";
      default:
        return "Speech recognition is unavailable. Check microphone access or type your message.";
    }
  }
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "麦克风权限被拒绝，请在浏览器设置中允许麦克风访问。";
    case "audio-capture":
      return "没有检测到可用的麦克风，请检查设备设置。";
    case "network":
      return "语音识别网络连接异常，请检查网络后重试。";
    case "no-speech":
      return "没有检测到语音，请点击麦克风重新聆听。";
    case "language-not-supported":
      return "当前浏览器暂不支持中文语音识别，请使用键盘输入。";
    case "aborted":
      return "";
    default:
      return "语音识别暂时不可用，请检查麦克风权限或改用键盘输入。";
  }
}

/** 只管理浏览器语音识别/播报生命周期；不负责聊天、搜索、详情或面板布局。 */
export function useFridayVoiceController({
  busyRef,
  openRef,
  closingRef,
  dispatchMachine,
  setInput,
  handleSendRef,
  language,
  assistantId,
  wakeWordEnabled,
  onAudioLevel,
}: Options) {
  const [listening, setListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const setSpeakingState = useCallback((value: boolean) => {
    speakingRef.current = value;
    setSpeaking(value);
  }, []);
  const [completed, setCompleted] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voiceSessionActive, setVoiceSessionActive] = useState(false);
  const lastSpokenMessageRef = useRef("");

  const listeningRef = useRef(false);
  const voiceSessionActiveRef = useRef(false);
  const voiceSessionIdRef = useRef(0);
  const noSpeechRetryCountRef = useRef(0);
  const microphonePermissionObservedRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recognitionStartTimerRef = useRef<number | null>(null);
  const speechSilenceTimerRef = useRef<number | null>(null);
  const playbackRef = useRef<TtsPlaybackHandle | null>(null);
  const voiceActivityInterruptRef = useRef<VoiceActivityInterruptController | null>(null);
  const recognitionErrorRef = useRef("");
  const pendingVoiceTextRef = useRef("");
  const manualVoiceStopRef = useRef(false);
  const voiceResumeTimerRef = useRef<number | null>(null);
  const startListeningRef = useRef<(automatic?: boolean) => void>(() => {});

  const clearVoiceResumeTimer = useCallback(() => {
    if (voiceResumeTimerRef.current !== null) {
      window.clearTimeout(voiceResumeTimerRef.current);
      voiceResumeTimerRef.current = null;
    }
  }, []);

  const setVoiceSession = useCallback((active: boolean) => {
    voiceSessionActiveRef.current = active;
    setVoiceSessionActive(active);

    if (!active) {
      dispatchMachine({
        type: "VOICE_STOP",
        sessionId: voiceSessionIdRef.current,
      });
      voiceSessionIdRef.current += 1;
    }
  }, [dispatchMachine]);

  const stopSpeech = useCallback((notifyMachine = true) => {
    const playback = playbackRef.current;
    playbackRef.current = null;
    const interruptController = voiceActivityInterruptRef.current;
    voiceActivityInterruptRef.current = null;
    void interruptController?.stop();
    playback?.cancel();
    setSpeakingState(false);
    if (notifyMachine) {
      dispatchMachine({
        type: "VOICE_STOP",
        sessionId: voiceSessionIdRef.current,
      });
    }
  }, [setSpeakingState, dispatchMachine]);

  const stopRecognition = useCallback((abort = true) => {
    const recognition = recognitionRef.current;

    if (recognitionStartTimerRef.current !== null) {
      window.clearTimeout(recognitionStartTimerRef.current);
      recognitionStartTimerRef.current = null;
    }
    if (speechSilenceTimerRef.current !== null) {
      window.clearTimeout(speechSilenceTimerRef.current);
      speechSilenceTimerRef.current = null;
    }
    recognitionRef.current = null;
    listeningRef.current = false;
    pendingVoiceTextRef.current = "";
    recognitionErrorRef.current = "";
    setListening(false);

    if (!recognition) return;

    try {
      if (abort) recognition.abort();
      else recognition.stop();
    } catch {
      // 忽略浏览器识别实例已结束的异常。
    }
  }, []);

  const stopAllVoice = useCallback(() => {
    setVoiceSession(false);
    clearVoiceResumeTimer();
    stopRecognition(true);
    stopSpeech();
  }, [setVoiceSession, clearVoiceResumeTimer, stopRecognition, stopSpeech]);

  const scheduleVoiceResume = useCallback(() => {
    clearVoiceResumeTimer();

    if (!voiceSessionActiveRef.current) return;
    if (!openRef.current || closingRef.current) return;
    if (busyRef.current || speakingRef.current) return;

    const sessionId = voiceSessionIdRef.current;
    voiceResumeTimerRef.current = window.setTimeout(() => {
      voiceResumeTimerRef.current = null;

      if (sessionId !== voiceSessionIdRef.current) return;
      if (!voiceSessionActiveRef.current) return;
      if (!openRef.current || closingRef.current) return;
      if (busyRef.current || listeningRef.current) return;

      startListeningRef.current(true);
    }, VOICE_RESUME_DELAY);
  }, [clearVoiceResumeTimer, openRef, closingRef, busyRef]);

  const startListening = useCallback((automatic = false) => {
    // 包括“正在等待 onstart”的阶段；避免 iOS Safari 并发启动识别实例。
    if (busyRef.current || listeningRef.current || recognitionRef.current) return;
    if (closingRef.current || !openRef.current) return;

    if (!automatic) noSpeechRetryCountRef.current = 0;
    if (!automatic && !voiceSessionActiveRef.current) {
      setVoiceSession(true);
    }
    if (!voiceSessionActiveRef.current) return;

    clearVoiceResumeTimer();
    setVoiceError("");

    if (typeof window === "undefined" || !window.isSecureContext) {
      setVoiceSession(false);
      setVoiceError(language === "en" ? "Speech recognition requires a secure connection (HTTPS or localhost)." : "语音识别需要安全连接，请使用 HTTPS 网站或 localhost。");
      return;
    }

    const SpeechRecognitionClass = getBrowserAsrConstructor();
    if (!SpeechRecognitionClass) {
      setVoiceSession(false);
      setVoiceError(language === "en" ? "Speech recognition is not supported by this browser. Please type instead." : "当前浏览器暂不支持语音识别，请使用键盘输入。");
      return;
    }

    stopSpeech();

    const sessionId = voiceSessionIdRef.current;
    dispatchMachine({ type: "VOICE_START_REQUESTED", sessionId });
    pendingVoiceTextRef.current = "";
    recognitionErrorRef.current = "";
    manualVoiceStopRef.current = false;

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new SpeechRecognitionClass();
    } catch {
      dispatchMachine({
        type: "VOICE_FAILED",
        sessionId: voiceSessionIdRef.current,
        code: "constructor-failed",
        message: language === "en" ? "Could not initialize speech recognition. Check browser compatibility or type instead." : "无法初始化语音识别，请检查浏览器兼容性或改用键盘输入。",
      });
      setVoiceSession(false);
      setVoiceError(language === "en" ? "Could not initialize speech recognition. Check browser compatibility or type instead." : "无法初始化语音识别，请检查浏览器兼容性或改用键盘输入。");
      return;
    }

    recognition.lang = language === "en" ? "en-GB" : "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      if (recognitionRef.current !== recognition) return;
      if (sessionId !== voiceSessionIdRef.current) return;
      if (recognitionStartTimerRef.current !== null) {
        window.clearTimeout(recognitionStartTimerRef.current);
        recognitionStartTimerRef.current = null;
      }
      listeningRef.current = true;
      microphonePermissionObservedRef.current = true;
      setListening(true);
      dispatchMachine({ type: "VOICE_STARTED", sessionId });
      setVoiceError("");
    };

    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return;
      if (sessionId !== voiceSessionIdRef.current) return;

      let finalText = "";
      let interimText = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript || "";
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }

      const recognizedText = (finalText || interimText)
        .trim()
        .slice(0, MAX_INPUT_LENGTH);
      if (recognizedText) {
        setInput(recognizedText);
        window.dispatchEvent(new CustomEvent("friday-home-transcript", { detail: { text: recognizedText } }));
        noSpeechRetryCountRef.current = 0;
        if (speechSilenceTimerRef.current !== null) window.clearTimeout(speechSilenceTimerRef.current);
        // Native Web Speech owns the iOS microphone. Reset a 1.5s result-silence
        // clock instead of opening a competing getUserMedia VAD stream.
        speechSilenceTimerRef.current = window.setTimeout(() => {
          speechSilenceTimerRef.current = null;
          if (recognitionRef.current !== recognition || sessionId !== voiceSessionIdRef.current) return;
          try { recognition.stop(); } catch { /* onend dispatches the final segment */ }
        }, 1500);
      }

      if (finalText.trim()) {
        let commandText = finalText.trim();
        if (wakeWordEnabled) {
          const wakePrefix = commandText.match(/^(?:(?:嘿|嗨|喂)\s*)?(?:friday|弗莱迪)[，,、:：\s-]*/i);
          if (!wakePrefix || !commandText.slice(wakePrefix[0].length).trim()) {
            pendingVoiceTextRef.current = "";
            setInput("");
            return;
          }
          commandText = commandText.slice(wakePrefix[0].length).trim();
        }
        dispatchMachine({ type: "VOICE_FINAL_TEXT", sessionId });
        pendingVoiceTextRef.current = commandText.slice(0, MAX_INPUT_LENGTH);
      }
    };

    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return;
      if (sessionId !== voiceSessionIdRef.current) return;

      recognitionErrorRef.current = event.error || "unknown";
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        microphonePermissionObservedRef.current = false;
      }
      const message = getSpeechErrorMessage(event.error, language);
      listeningRef.current = false;
      setListening(false);
      if (message) {
        dispatchMachine({
          type: "VOICE_FAILED",
          sessionId,
          code: event.error || "unknown",
          message,
        });
        setVoiceError(message);
      }

      // WebKit 通常会在 error 后派发 end，但部分异常路径可能漏掉 end。
      // 保留短暂宽限期，避免与正在收尾的识别器并发；若 end 始终缺失，
      // 自动释放实例引用，让用户下一次点击可以创建全新的 Recognition。
      if (recognitionStartTimerRef.current !== null) {
        window.clearTimeout(recognitionStartTimerRef.current);
      }
      recognitionStartTimerRef.current = window.setTimeout(() => {
        recognitionStartTimerRef.current = null;
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        listeningRef.current = false;
        setListening(false);
        try {
          recognition.abort();
        } catch {
          // 实例可能已由浏览器自行结束。
        }
      }, 1500);
    };

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      if (sessionId !== voiceSessionIdRef.current) return;

      if (recognitionStartTimerRef.current !== null) {
        window.clearTimeout(recognitionStartTimerRef.current);
        recognitionStartTimerRef.current = null;
      }
      if (speechSilenceTimerRef.current !== null) {
        window.clearTimeout(speechSilenceTimerRef.current);
        speechSilenceTimerRef.current = null;
      }
      recognitionRef.current = null;
      listeningRef.current = false;
      setListening(false);
      dispatchMachine({ type: "VOICE_ENDED", sessionId });

      const finalText = pendingVoiceTextRef.current.trim();
      const recognitionError = recognitionErrorRef.current;
      const wasManualStop = manualVoiceStopRef.current;

      pendingVoiceTextRef.current = "";
      recognitionErrorRef.current = "";
      manualVoiceStopRef.current = false;

      if (finalText) {
        setInput("");
        void handleSendRef.current(finalText, !wasManualStop);
        return;
      }
      if (wasManualStop) {
        setVoiceSession(false);
        return;
      }
      if (!voiceSessionActiveRef.current) return;

      if (recognitionError && recognitionError !== "aborted") {
        if (recognitionError === "no-speech") {
          if (noSpeechRetryCountRef.current < 2) {
            noSpeechRetryCountRef.current += 1;
            scheduleVoiceResume();
          } else {
            setVoiceError(language === "en" ? "No speech detected after two automatic retries. Tap the microphone to try again." : "连续两次未检测到语音，已暂停自动重试，请点击麦克风继续。");
          }
        } else if (shouldEndVoiceSession(recognitionError)) {
          // 权限、设备或网络错误后结束本轮会话，避免残留活动态。
          // 用户修复问题后仍可再次点击麦克风启动新会话。
          setVoiceSession(false);
        }
        return;
      }
      if (openRef.current && !busyRef.current) {
        if (noSpeechRetryCountRef.current < 2) {
          noSpeechRetryCountRef.current += 1;
          scheduleVoiceResume();
        } else {
          setVoiceError(language === "en" ? "No complete speech after two automatic retries. Tap the microphone to continue." : "连续两次未识别到完整语音，已暂停自动重试，请点击麦克风继续。");
        }
      }
    };

    recognitionRef.current = recognition;
    try {
      // Safari 偶尔不及时派发 onstart；看门狗避免启动锁永久残留。
      recognitionStartTimerRef.current = window.setTimeout(() => {
        recognitionStartTimerRef.current = null;
        if (recognitionRef.current !== recognition || listeningRef.current) return;
        recognitionRef.current = null;
        try {
          recognition.abort();
        } catch {
          // 忽略已失效实例。
        }
        setVoiceSession(false);
        setVoiceError(language === "en" ? "The browser could not start speech recognition. Tap the microphone to retry." : "浏览器未能启动语音识别，请再次点击麦克风重试。");
      }, 8000);

      // 首次启动必须在用户点击的同步调用链内。
      recognition.start();
    } catch (recognitionError) {
      if (recognitionStartTimerRef.current !== null) {
        window.clearTimeout(recognitionStartTimerRef.current);
        recognitionStartTimerRef.current = null;
      }
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
      dispatchMachine({
        type: "VOICE_FAILED",
        sessionId,
        code: "start-failed",
        message: language === "en" ? "Speech recognition failed to start." : "语音识别启动失败",
      });
      listeningRef.current = false;
      setListening(false);
      const errorName =
        recognitionError instanceof Error ? recognitionError.name : "";
      const startErrorMessage =
        errorName === "NotAllowedError" || errorName === "SecurityError"
          ? (language === "en" ? "Microphone access was not granted. Allow it in site settings." : "浏览器未授予麦克风权限，请在网站设置中允许麦克风访问。")
          : errorName === "InvalidStateError"
            ? (language === "en" ? "Speech recognition is still starting. Please wait and try again." : "语音识别仍在启动，请稍后再点击麦克风。")
            : automatic
              ? (language === "en" ? "The browser did not allow automatic microphone restart. Tap the microphone to continue." : "浏览器未允许自动恢复麦克风，请点击麦克风继续聆听。")
              : (language === "en" ? "Speech recognition failed to start. Check microphone permissions and try again." : "语音识别启动失败，请检查麦克风权限后重试。");
      setVoiceSession(false);
      setVoiceError(startErrorMessage);
    }
  }, [
    busyRef,
    closingRef,
    openRef,
    setVoiceSession,
    clearVoiceResumeTimer,
    scheduleVoiceResume,
    setVoiceError,
    stopSpeech,
    dispatchMachine,
    setInput,
    handleSendRef,
    language,
  ]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const speakText = useCallback((text: string, messageId: string) => {
    if (!voiceEnabled || !text.trim()) {
      setSpeakingState(false);
      setCompleted(true);
      scheduleVoiceResume();
      return;
    }

    const provider = createFridayTtsProvider(language, assistantId);
    if (!provider) {
      setSpeakingState(false);
      setCompleted(true);
      dispatchMachine({
        type: "VOICE_FAILED",
        sessionId: voiceSessionIdRef.current,
        code: "speech-synthesis-unsupported",
        message: language === "en" ? "Speech synthesis is not supported by this browser." : "当前浏览器不支持语音播报。",
      });
      setVoiceError(language === "en" ? "Speech synthesis is not supported by this browser." : "当前浏览器不支持语音播报。");
      scheduleVoiceResume();
      return;
    }

    stopSpeech();
    setCompleted(false);
    lastSpokenMessageRef.current = messageId;

    try {
      const playback = provider.speak(text, {
        onStart: () => {
          if (playbackRef.current !== playback) return;
          setSpeakingState(true);
          dispatchMachine({
            type: "VOICE_SPEAK_START",
            sessionId: voiceSessionIdRef.current,
          });
          // Acoustic interruption is armed only in an active voice session and
          // only when the browser reports an already-granted mic permission.
          if (voiceSessionActiveRef.current) {
            const interruptController = createVoiceActivityInterruptController({
              hasPriorMicGrant: () => microphonePermissionObservedRef.current,
              captureOptions: { onAudioLevel },
              onInterrupt: () => {
                if (playbackRef.current !== playback) return;
                playbackRef.current = null;
                playback.cancel();
                setSpeakingState(false);
                startListeningRef.current(true);
              },
            });
            voiceActivityInterruptRef.current = interruptController;
            void interruptController.start().then((armed) => {
              if (!armed && voiceActivityInterruptRef.current === interruptController) {
                voiceActivityInterruptRef.current = null;
              }
            });
          }
        },
        onEnd: () => {
          if (playbackRef.current !== playback) return;
          playbackRef.current = null;
          const interruptController = voiceActivityInterruptRef.current;
          voiceActivityInterruptRef.current = null;
          setSpeakingState(false);
          setCompleted(true);
          dispatchMachine({
            type: "VOICE_SPEAK_END",
            sessionId: voiceSessionIdRef.current,
          });
          if (interruptController) {
            void interruptController.stop().then(
              () => scheduleVoiceResume(),
              () => scheduleVoiceResume(),
            );
          } else {
            scheduleVoiceResume();
          }
        },
        onError: () => {
          if (playbackRef.current !== playback) return;
          playbackRef.current = null;
          const interruptController = voiceActivityInterruptRef.current;
          voiceActivityInterruptRef.current = null;
          setSpeakingState(false);
          setCompleted(true);
          dispatchMachine({
            type: "VOICE_FAILED",
            sessionId: voiceSessionIdRef.current,
            code: "speech-synthesis-error",
            message: language === "en" ? "Speech was interrupted." : "语音播报中断",
          });
          setVoiceError(language === "en" ? "Speech was interrupted. Continue typing or turn voice output back on." : "语音播报中断，请继续使用文字或重新开启语音。");
          if (interruptController) {
            void interruptController.stop().then(
              () => scheduleVoiceResume(),
              () => scheduleVoiceResume(),
            );
          } else {
            scheduleVoiceResume();
          }
        },
      });
      playbackRef.current = playback;
    } catch (speechError) {
      console.error("[Friday] Speech synthesis failed:", speechError);
      playbackRef.current = null;
      setSpeakingState(false);
      setCompleted(true);
      dispatchMachine({
        type: "VOICE_FAILED",
        sessionId: voiceSessionIdRef.current,
        code: "speech-synthesis-start-failed",
        message: language === "en" ? "Speech playback failed to start." : "语音播报启动失败",
      });
      setVoiceError(language === "en" ? "Could not start speech playback. Continue typing or turn voice output back on." : "语音播报启动失败，请继续使用文字或重新开启语音。");
      scheduleVoiceResume();
    }
  }, [voiceEnabled, language, assistantId, stopSpeech, scheduleVoiceResume, setVoiceError, dispatchMachine]);

  const toggleVoiceEnabled = useCallback(() => {
    if (voiceEnabled) {
      stopSpeech();
      if (voiceSessionActiveRef.current) scheduleVoiceResume();
    }
    setVoiceEnabled((value) => !value);
  }, [voiceEnabled, stopSpeech, scheduleVoiceResume]);

  const stopSpeechAndResume = useCallback(() => {
    stopSpeech();
    if (voiceSessionActiveRef.current) scheduleVoiceResume();
  }, [stopSpeech, scheduleVoiceResume]);

  const toggleListening = useCallback(() => {
    if (listeningRef.current) {
      // 等待 onresult/onend 收齐最终识别文本，不提前结束 session。
      manualVoiceStopRef.current = true;
      clearVoiceResumeTimer();
      try {
        recognitionRef.current?.stop();
      } catch {
        manualVoiceStopRef.current = false;
        stopRecognition(true);
        setVoiceSession(false);
      }
    } else {
      setVoiceSession(true);
      startListeningRef.current(false);
    }
  }, [clearVoiceResumeTimer, stopRecognition, setVoiceSession]);

  useEffect(() => {
    return () => {
      voiceSessionActiveRef.current = false;
      voiceSessionIdRef.current += 1;
      clearVoiceResumeTimer();
      stopRecognition(true);
      stopSpeech(false);
    };
  }, [clearVoiceResumeTimer, stopRecognition, stopSpeech]);

  return {
    listening,
    voiceEnabled,
    speaking,
    completed,
    voiceError,
    voiceSessionActive,
    voiceSessionActiveRef,
    startListeningRef,
    scheduleVoiceResume,
    setSpeaking: setSpeakingState,
    clearVoiceResumeTimer,
    setVoiceSession,
    stopRecognition,
    stopSpeech,
    stopAllVoice,
    startListening,
    speakText,
    toggleVoiceEnabled,
    stopSpeechAndResume,
    toggleListening,
    setVoiceError,
    setCompleted,
    lastSpokenMessageRef,
  };
}
