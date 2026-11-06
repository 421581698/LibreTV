export type TtsPlaybackEvents = {
  onStart: () => void;
  onEnd: () => void;
  onError: () => void;
};

export type TtsPlaybackHandle = {
  cancel: () => void;
};

/**
 * Provider boundary for Friday speech output.
 * Remote/model-backed providers can implement the same contract later without
 * coupling the voice-session state machine to a particular TTS engine.
 */
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
 * Friday's production voice routing:
 * - English uses the real Piper JARVIS model through the authenticated same-origin API.
 * - Chinese keeps the browser's zh-CN voice until a dedicated Mandarin model is selected.
 */
export function createFridayTtsProvider(language: "zh" | "en" = "zh"): FridayTtsProvider | null {
  if (language === "zh") return createBrowserTtsProvider("zh");
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;

  return {
    speak(text, events) {
      const controller = new AbortController();
      let audio: HTMLAudioElement | null = null;
      let objectUrl = "";
      let cancelled = false;
      let settled = false;

      const cleanup = () => {
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

      const fail = () => {
        if (cancelled || settled) return;
        settled = true;
        cleanup();
        events.onError();
      };

      void fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
        cache: "no-store",
      }).then(async (response) => {
        if (!response.ok) throw new Error(`JARVIS TTS request failed: ${response.status}`);
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("audio/wav")) {
          throw new Error("JARVIS TTS returned an unsupported audio format.");
        }
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        audio = new Audio(objectUrl);
        audio.preload = "auto";
        audio.onplay = () => {
          if (!cancelled && !settled) events.onStart();
        };
        audio.onended = () => {
          if (cancelled || settled) return;
          settled = true;
          cleanup();
          events.onEnd();
        };
        audio.onerror = fail;
        await audio.play();
      }).catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        console.error("[Friday] JARVIS TTS unavailable:", error);
        fail();
      });

      return {
        cancel() {
          if (cancelled) return;
          cancelled = true;
          controller.abort();
          cleanup();
        },
      };
    },
  };
}
