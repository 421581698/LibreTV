"use client";

import React from "react";
import type { RefObject } from "react";

const MAX_INPUT_LENGTH = 1000;

export function FridayComposer({
  inputRef, input, setInput, busy, closing, listening, onSend, onToggleListening,
  voiceError, voiceEnabled, onToggleVoiceEnabled, onClearConversation,
  speaking, onStopSpeechAndResume, onInterrupt, onToggleExpanded, expanded, onHideAssistant, language,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  closing: boolean;
  listening: boolean;
  onSend: () => void;
  onToggleListening: () => void;
  voiceError: string;
  voiceEnabled: boolean;
  onToggleVoiceEnabled: () => void;
  onClearConversation: () => void;
  speaking: boolean;
  onStopSpeechAndResume: () => void;
  onInterrupt: () => void;
  onToggleExpanded: () => void;
  expanded: boolean;
  onHideAssistant: () => void;
  language: "zh" | "en";
}) {
  return (
  <footer className="friday-input-area">
    <div className="friday-input-box">
      <button
        type="button"
        className="friday-plus-btn"
        aria-label={language === "en" ? "More options" : "附加功能"}
        title={language === "en" ? "More options coming soon" : "附加功能暂未接入"}
        disabled
      >
        +
      </button>
    
      <div className="friday-input-divider" />
    
      <textarea
        ref={inputRef}
        className="friday-textarea"
        value={input}
        rows={1}
        maxLength={MAX_INPUT_LENGTH}
        placeholder={
          listening ? (language === "en" ? "Listening…" : "正在聆听…") : (language === "en" ? "Ask Friday..." : "询问 Friday...")
        }
        disabled={busy || closing}
        onChange={(event) => {
          setInput(
            event.target.value.slice(0, MAX_INPUT_LENGTH),
          );
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            onSend();
          }
        }}
      />
    
      <button
        type="button"
        className={`friday-mic-btn ${
          listening ? "active" : ""
        }`}
        disabled={busy || closing}
        aria-label={
          listening ? (language === "en" ? "Stop voice input" : "停止语音输入") : (language === "en" ? "Start voice input" : "开始语音输入")
        }
        title={
          listening
            ? (language === "en" ? "Stop listening" : "停止本次聆听")
            : (language === "en" ? "Start voice input or resume conversation" : "开始语音输入或恢复连续对话")
        }
        aria-describedby={voiceError ? "friday-voice-error" : undefined}
        onClick={onToggleListening}
      >
        {listening ? "Ⅱ" : "♩"}
      </button>
    
      <button
        type="button"
        className="friday-send-btn"
        disabled={busy || closing || !input.trim()}
        aria-label={language === "en" ? "Send message" : "发送消息"}
        onClick={onSend}
      >
        ↑
      </button>
    </div>
    
    {voiceError ? (
      <div
        id="friday-voice-error"
        className="friday-voice-error"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {voiceError}
      </div>
    ) : null}
    
    <div className="friday-tools">
      <div className="friday-tool-group">
        <button
          type="button"
          className={`friday-tool-btn ${
            voiceEnabled ? "active" : ""
          }`}
          onClick={onToggleVoiceEnabled}
        >
          {voiceEnabled ? (language === "en" ? "Voice on" : "语音播报开启") : (language === "en" ? "Voice off" : "语音播报关闭")}
        </button>
    
        <button
          type="button"
          className="friday-tool-btn"
          onClick={onClearConversation}
        >
          {language === "en" ? "New chat" : "新对话"}
        </button>
      </div>
    
      <div className="friday-tool-group">
        {speaking ? (
          <button
            type="button"
            className="friday-tool-btn active"
            onClick={onStopSpeechAndResume}
          >
            {language === "en" ? "Stop speaking" : "停止播报"}
          </button>
        ) : null}
    
        {busy ? (
          <button
            type="button"
            className="friday-tool-btn active"
            onClick={onInterrupt}
          >
            {language === "en" ? "Interrupt" : "中断"}
          </button>
        ) : null}
    
        <button
          type="button"
          className="friday-tool-btn active"
          onClick={onToggleExpanded}
        >
          {expanded ? (language === "en" ? "Collapse" : "收起面板") : (language === "en" ? "Expand chat" : "展开对话")}
        </button>
    
        <button
          type="button"
          className="friday-tool-btn"
          onClick={onHideAssistant}
        >
          {language === "en" ? "Hide assistant" : "隐藏助手"}
        </button>
      </div>
    </div>
  </footer>
  );
}