"use client";

import React from "react";
import type { RefObject } from "react";
import type { MovieData, MovieItem } from "./FridayPanel";
import type { FridayWorkflowView } from "./useFridayChatSession";
import { FridayMovieResults } from "./FridayMovieResults";

export type FridayConversationEntry = {
  id: string;
  isUser: boolean;
  text: string;
  movies: MovieData[];
  workflows?: Record<string, FridayWorkflowView>;
};

function WorkflowSummary({ workflow }: { workflow: FridayWorkflowView }) {
  const statusLabel = workflow.status === "running" ? "执行中" : workflow.status === "completed" ? "已完成" : "未完成";
  return (
    <section className="friday-workflow" aria-live="polite">
      <div className="friday-workflow-heading">
        <strong>Friday 资源核验</strong>
        <span>{statusLabel}</span>
      </div>
      {workflow.status === "running" ? <p>正在探测来源并整理片源侧证据…</p> : null}
      {workflow.status === "failed" ? <p>任务未完整完成：{workflow.error || "部分步骤失败"}</p> : null}
      {workflow.sourceChecks ? (
        <div className="friday-workflow-block">
          <strong>影片-来源探测 · {workflow.sourceChecks.filter((item) => item.reachable).length}/{workflow.sourceChecks.length} 次解析请求成功</strong>
          <p>请求成功仅表示本次片源解析接口返回了有效结果，不代表播放器已成功解码或播放；本阶段不提供真实播放加载速度。</p>
          {workflow.sourceChecks.length ? workflow.sourceChecks.map((item) => (
            <div className="friday-workflow-row" key={item.candidateId || item.sourceId}>
              <span>{item.sourceId}</span>
              <span>{item.reachable ? "解析请求成功" : "探测失败"}{typeof item.latencyMs === "number" ? ` · ${Math.round(item.latencyMs)} ms` : ""}</span>
            </div>
          )) : <p>没有可探测的匹配来源。</p>}
        </div>
      ) : null}
      {workflow.qualityChecks ? (
        <div className="friday-workflow-block">
          <strong>画质证据</strong>
          <p>分辨率来自 HLS 清单或媒体分片解析；这是片源侧证据，不等同于播放器解码后的 videoHeight 实测。</p>
          {workflow.qualityChecks.map((item) => (
            <div className="friday-workflow-row" key={item.candidateId || item.sourceId}>
              <span>{item.sourceId}{item.candidateId ? ` · ${item.candidateId.split(":").slice(1).join(":")}` : ""}</span>
              <span>{item.status === "resolution_detected" ? `${item.resolutionHeight}P（清单/分片解析）` : item.status === "unavailable" ? "探测失败" : item.status === "resolution_unknown" ? "已探测，分辨率未知" : "未取得证据"}</span>
            </div>
          ))}
        </div>
      ) : null}
      {workflow.review ? (
        <div className="friday-workflow-review">
          Review：{workflow.review.accepted ? "结构与证据检查通过" : "发现待处理问题"}
          · {workflow.review.candidateCount} 条候选 · {workflow.review.assessmentCount} 项来源评估
          {workflow.review.findings.length ? <p>{workflow.review.findings.join("、")}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export function FridayConversation({
  messagesRef,
  messages,
  listening,
  busy,
  status,
  error,
  onOpenMovie,
}: {
  messagesRef: RefObject<HTMLDivElement | null>;
  messages: FridayConversationEntry[];
  listening: boolean;
  busy: boolean;
  status: string;
  error?: { message?: string } | null;
  onOpenMovie: (movie: MovieItem) => void;
}) {
  return (
    <div ref={messagesRef} className="friday-messages">
      {messages.length === 0 ? (
        <div className="friday-welcome">
          <div className="friday-welcome-kicker">YOUR AMBIENT AI</div>
          <div className="friday-welcome-title">你好，我是 Friday。</div>
          <div className="friday-welcome-text">
            {listening ? "我正在聆听。告诉我你想看什么电影或电视剧。" : "告诉我你想看什么，或者让我帮你寻找更好的影视资源。"}
          </div>
        </div>
      ) : null}

      {messages.map((message) => (
        <React.Fragment key={message.id}>
          {message.text ? (
            <div className={`friday-message ${message.isUser ? "friday-message-user" : ""}`}>
              <div className="friday-message-content">{message.text}</div>
            </div>
          ) : null}
          {message.movies.map((data) => (
            <React.Fragment key={data.searchId}>
              <FridayMovieResults data={data} onOpen={onOpenMovie} />
              {message.workflows?.[data.searchId] ? <WorkflowSummary workflow={message.workflows[data.searchId]} /> : null}
            </React.Fragment>
          ))}
        </React.Fragment>
      ))}

      {busy ? (
        <div className="friday-status">
          {status === "submitted" ? "Friday 正在接收消息…" : "正在为你寻找合适的影视资源…"}
        </div>
      ) : null}
      {error ? <div className="friday-error">{error.message || "请求失败，请稍后重试。"}</div> : null}
    </div>
  );
}
