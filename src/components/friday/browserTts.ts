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
      utterance.lang = language === "en" ? "en-GB" : "zh-CN";
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
 * - English: Cloudflare Workers AI / Deepgram Aura-2, with browser TTS fallback.
 * - Chinese: browser zh-CN TTS. Aura-2 is English-only and must not receive Chinese.
 *
 * No third-party paid TTS provider is enabled by this implementation.
 */
export function createFridayTtsProvider(language: "zh" | "en" = "zh"): FridayTtsProvider | null {
  if (language === "zh") return createBrowserTtsProvider("zh");
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;

  const browserFallback = createBrowserTtsProvider("en");

  return {
    speak(text, events) {
      const controller = new AbortController();
      let audio: HTMLAudioElement | null = null;
      let objectUrl = "";
      let fallbackHandle: TtsPlaybackHandle | null = null;
      let cancelled = false;
      let settled = false;
      let usingFallback = false;

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
          fallbackHandle = browserFallback.speak(text, events);
        } else {
          settled = true;
          events.onError();
        }
      };

      void fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: "en" }),
        signal: controller.signal,
        cache: "no-store",
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Workers AI TTS request failed: ${response.status}`);
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("audio/mpeg")) {
          throw new Error("Workers AI TTS returned an unsupported audio format.");
        }
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        audio = new Audio(objectUrl);
        audio.preload = "auto";
        audio.onplay = () => {
          if (!cancelled && !settled && !usingFallback) events.onStart();
        };
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
        console.error("[Friday] Cloudflare TTS unavailable; using browser voice:", error);
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
