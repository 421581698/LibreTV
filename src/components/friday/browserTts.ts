export type TtsPlaybackEvents = {
  onStart: () => void;
  onEnd: () => void;
  onError: () => void;
};

export type TtsPlaybackHandle = {
  cancel: () => void;
};

export type FridayTtsProvider = {
  speak: (text: string, events: TtsPlaybackEvents) => TtsPlaybackHandle;
};

export function createBrowserTtsProvider(language: "zh" | "en" = "zh", voiceStyle: "auto" | "jarvis" | "warm" | "clear" = "auto"): FridayTtsProvider | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }

  return {
    speak(text, events) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language === "en" ? (voiceStyle === "jarvis" || voiceStyle === "warm" ? "en-GB" : "en-US") : "zh-CN";
      utterance.rate = 1;
      utterance.pitch = voiceStyle === "jarvis" ? 0.82 : 1;
      const voicePattern = voiceStyle === "jarvis"
        ? /yunxi|ryan|david|daniel|male|男/i
        : voiceStyle === "warm"
          ? /xiaoxiao|sonia|female|女/i
          : voiceStyle === "clear"
            ? /xiaoyi|ava/i
            : null;
      if (voicePattern) {
        const matchingVoice = window.speechSynthesis.getVoices().find((voice) =>
          voicePattern.test(voice.name) && (language === "zh" ? /^zh(-|_)/i.test(voice.lang) : /^en(-|_)/i.test(voice.lang))
        );
        if (matchingVoice) utterance.voice = matchingVoice;
      }
      utterance.onstart = events.onStart;
      utterance.onend = events.onEnd;
      utterance.onerror = events.onError;

      window.speechSynthesis.speak(utterance);

      return {
        cancel() {
          utterance.onstart = null;
          utterance.onend = null;
          utterance.onerror = null;
          try {
            window.speechSynthesis.cancel();
          } catch {
            // Cancellation is best-effort; the session controller owns recovery.
          }
        },
      };
    },
  };
}

/**
 * Friday voice routing:
 * - Chinese: Microsoft Edge TTS zh-CN-XiaoxiaoNeural.
 * - English: Microsoft Edge TTS en-US-AvaMultilingualNeural.
 * - Non-Jarvis profiles may fall back to browser SpeechSynthesis.
 * - Jarvis never falls back to a device/system voice; failures are surfaced instead.
 *
 * The Edge endpoint is unofficial and may change.
 */
export type FridayTtsAssistantId = "friday" | "jarvis" | "lin-meimei";

export function createFridayTtsProvider(
  language: "zh" | "en" = "zh",
  assistantId: FridayTtsAssistantId = "friday",
  voiceStyle: "auto" | "jarvis" | "warm" | "clear" = "auto",
): FridayTtsProvider | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;

  const fallbackVoiceStyle = voiceStyle === "auto" && assistantId === "jarvis" ? "jarvis" : voiceStyle;
  const browserFallback = createBrowserTtsProvider(language, fallbackVoiceStyle);

  return {
    speak(text, events) {
      const controller = new AbortController();
      let audio: HTMLAudioElement | null = null;
      let objectUrl = "";
      let fallbackHandle: TtsPlaybackHandle | null = null;
      let cancelled = false;
      let settled = false;
      let usingFallback = false;
      let startNotified = false;

      const notifyStart = () => {
        if (cancelled || settled || startNotified) return;
        startNotified = true;
        events.onStart();
      };

      const cleanupAudio = () => {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = "";
        }
        if (audio) {
          audio.onplay = null;
          audio.onended = null;
          audio.onerror = null;
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          audio = null;
        }
      };

      const fallback = () => {
        if (cancelled || settled || usingFallback) return;
        usingFallback = true;
        cleanupAudio();
        // Jarvis must never silently become an iOS/Siri system voice.
        // Keep browser fallback only for the non-Jarvis assistant profiles.
        if (assistantId === "jarvis" || voiceStyle === "jarvis") {
          settled = true;
          events.onError();
          return;
        }
        if (browserFallback) {
          fallbackHandle = browserFallback.speak(text, {
            ...events,
            onStart: notifyStart,
          });
        } else {
          settled = true;
          events.onError();
        }
      };

      void fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language, assistantId, ...(voiceStyle !== "auto" ? { voiceStyle } : {}) }),
        signal: controller.signal,
        cache: "no-store",
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Edge TTS request failed: ${response.status}`);
        const contentType = response.headers.get("content-type") || "";
        const normalizedContentType = contentType.toLowerCase();
        if (!normalizedContentType.includes("audio/mpeg") && !normalizedContentType.includes("audio/wav")) {
          throw new Error("Friday TTS returned an unsupported audio format.");
        }
        const blob = await response.blob();
        if (!blob.size) throw new Error("Edge TTS returned empty audio.");
        if (cancelled) return;

        objectUrl = URL.createObjectURL(blob);
        audio = new Audio(objectUrl);
        audio.preload = "auto";
        audio.onplay = notifyStart;
        audio.onended = () => {
          if (cancelled || settled || usingFallback) return;
          settled = true;
          cleanupAudio();
          events.onEnd();
        };
        audio.onerror = fallback;
        await audio.play();
      }).catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        console.error("[Friday] Remote TTS unavailable; using browser voice:", error);
        fallback();
      });

      return {
        cancel() {
          if (cancelled) return;
          cancelled = true;
          controller.abort();
          cleanupAudio();
          fallbackHandle?.cancel();
          fallbackHandle = null;
        },
      };
    },
  };
}
