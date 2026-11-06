"use client";

import React from "react";
import type { RefObject } from "react";
import { FridayOrbVisual } from "@/components/friday/FridayOrbVisual";
import { FridayConversation } from "@/components/friday/FridayConversation";
import { FridayComposer } from "@/components/friday/FridayComposer";
import { getMovieDataForMessage, getPartText } from "@/lib/friday/message";
import type { FridayWorkflowView } from "@/components/friday/useFridayChatSession";
import type { TaskSnapshot } from "@/lib/friday/task-runtime";


export type MovieItem = {
  sourceKey?: string;
  sourceName?: string;
  vodId?: string | number;
  name?: string;
  pic?: string;
  typeName?: string;
  year?: string | number;
  area?: string;
  remarks?: string;
  sourceUrl?: string;
  isAdult?: boolean;
};

export type MovieData = {
  searchId: string;
  keyword: string;
  total?: number;
  totalFound?: number;
  returnedCount?: number;
  outcomes?: Array<{
    sourceKey: string;
    ok: boolean;
    list: MovieItem[];
    error?: string;
    timedOut?: boolean;
    ms?: number;
  }>;
  results: MovieItem[];
  createdAt?: number;
};

export type MessagePartLike = {
  type?: string;
  text?: string;
  data?: unknown;
};

export type MessageLike = {
  id: string;
  role: string;
  parts?: MessagePartLike[];
};



type FridayPanelProps = {
  expanded: boolean;
  immersive: boolean;
  closing: boolean;
  auroraState: "standby" | "listening" | "thinking" | "speaking" | "completed";
  agentState: string;
  voiceState: string;
  stateLabel: string;
  onAnimationEnd: (event: React.AnimationEvent<HTMLElement>) => void;
  onClose: () => void;
  messagesRef: RefObject<HTMLDivElement | null>;
  messages: MessageLike[];
  workflowBySearchId: Record<string, FridayWorkflowView>;
  restoredTasks: TaskSnapshot[];
  listening: boolean;
  busy: boolean;
  status: string;
  error?: { message?: string } | null;
  speaking: boolean;
  completed: boolean;
  voiceSessionActive: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  onToggleListening: () => void;
  voiceError: string;
  voiceEnabled: boolean;
  onToggleVoiceEnabled: () => void;
  onClearConversation: () => void;
  onStopSpeechAndResume: () => void;
  onInterrupt: () => void;
  onToggleExpanded: () => void;
  onHideAssistant: () => void;
  onOpenMovie: (movie: MovieItem) => void;
  language: "zh" | "en";
  onLanguageChange: (language: "zh" | "en") => void;
};

export { getMovieDataForMessage, getPartText } from "@/lib/friday/message";








export function FridayPanel({
  expanded, immersive, closing, auroraState, agentState, voiceState, stateLabel,
  onAnimationEnd, onClose, messagesRef, messages, workflowBySearchId, restoredTasks, listening, busy, status,
  error, speaking, completed, voiceSessionActive, inputRef, input, setInput,
  onSend, onToggleListening, voiceError, voiceEnabled, onToggleVoiceEnabled,
  onClearConversation, onStopSpeechAndResume, onInterrupt, onToggleExpanded,
  onHideAssistant, onOpenMovie, language, onLanguageChange,
}: FridayPanelProps) {
  const typedMessages = messages;
  const conversationEntries = typedMessages.map((message) => ({
    id: message.id,
    isUser: message.role === "user",
    text: getPartText(message),
    movies: getMovieDataForMessage(message),
    workflows: workflowBySearchId,
  }));
  return (
              <section
                className={`friday-panel ${
                  expanded ? "friday-expanded" : ""
                } ${immersive ? "friday-immersive" : ""} ${closing ? "friday-closing" : ""}`}
                data-state={auroraState}
                data-agent-state={agentState}
                data-voice-state={voiceState}
                aria-label={language === "en" ? "Friday AI assistant" : "Friday AI 助手"}
                aria-hidden={closing}
                onAnimationEnd={onAnimationEnd}
              >
                <div className="friday-canvas-top">
                  <div className="friday-wordmark">Friday</div>
                  <button type="button" className="friday-tool-btn" aria-label={language === "en" ? "Switch language" : "切换语言"} title={language === "en" ? "Switch to Chinese" : "切换到 English"} onClick={() => onLanguageChange(language === "zh" ? "en" : "zh")}>{language === "zh" ? "中文 / EN" : "EN / 中文"}</button>
    
                  <div className="friday-header-actions">
                    <div className="friday-state-wrap">
                      <span className="friday-status-dot" />
                      <span>{stateLabel}</span>
                    </div>
    
                    <button
                      type="button"
                      className="friday-close-btn"
                      title={language === "en" ? "Close Friday" : "关闭 Friday"}
                      aria-label={language === "en" ? "Close Friday" : "关闭 Friday"}
                      onClick={onClose}
                    >
                      ×
                    </button>
                  </div>
                </div>
    
                <FridayConversation
                  messagesRef={messagesRef}
                  messages={conversationEntries}
                  listening={listening}
                  busy={busy}
                  status={status}
                  error={error}
                  onOpenMovie={onOpenMovie}
                  language={language}
                />
    
                <div className="friday-orb-stage">
                  <span className="friday-orb-status" role="status" aria-live="polite" aria-atomic="true">
                    {voiceError
                      ? (language === "en" ? "Voice unavailable — retry or type" : "语音暂时不可用，可重试或使用文字输入")
                      : listening
                        ? (language === "en" ? "Tell me what you want to watch" : "请说出你想看的影片")
                      : busy
                        ? (language === "en" ? "Connecting to video sources" : "正在连接影视资源")
                        : speaking
                          ? (language === "en" ? "Speaking" : "正在为你播报")
                          : completed
                            ? (language === "en" ? "Ready" : "已经为你准备好了")
                            : voiceSessionActive
                              ? (language === "en" ? "Waiting to resume listening" : "等待恢复语音聆听")
                              : (language === "en" ? "Friday standing by" : "Friday 随时待命")}
                  </span>
    
                  <FridayOrbVisual state={auroraState} />
                </div>
    
                <FridayComposer
                  inputRef={inputRef}
                  input={input}
                  setInput={setInput}
                  busy={busy}
                  closing={closing}
                  listening={listening}
                  onSend={onSend}
                  onToggleListening={onToggleListening}
                  voiceError={voiceError}
                  voiceEnabled={voiceEnabled}
                  onToggleVoiceEnabled={onToggleVoiceEnabled}
                  onClearConversation={onClearConversation}
                  speaking={speaking}
                  onStopSpeechAndResume={onStopSpeechAndResume}
                  onInterrupt={onInterrupt}
                  onToggleExpanded={onToggleExpanded}
                  expanded={expanded}
                  onHideAssistant={onHideAssistant}
                  language={language}
                />
              </section>
  );
}
