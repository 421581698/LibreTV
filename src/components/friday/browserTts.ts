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
