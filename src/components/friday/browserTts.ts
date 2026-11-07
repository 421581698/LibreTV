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

export function createBrowserTtsProvider(language: "zh" | "en" = "zh"): FridayTtsProvider | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }

  return {
    speak(text, events) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language === "en" ? "en-US" : "zh-CN";
      utterance.rate = 1;
      utterance.pitch = 1;
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
 * - Any upstream, network, or playback failure falls back to browser SpeechSynthesis.
 *
 * The Edge endpoint is unofficial and may change; browser fallback remains available.
 */
export type FridayTtsAssistantId = "friday" | "jarvis" | "lin-meimei";

export function createFridayTtsProvider(
  language: "zh" | "en" = "zh",
  assistantId: FridayTtsAssistantId = "friday",
): FridayTtsProvider | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;

  const browserFallback = createBrowserTtsProvider(language);

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
        body: JSON.stringify({ text, language, assistantId }),
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
