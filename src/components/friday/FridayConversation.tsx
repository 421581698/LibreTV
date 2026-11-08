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

function WorkflowSummary({ workflow, searchId, onRetryWorkflow, language, movies, onOpenMovie }: { workflow: FridayWorkflowView; searchId: string; onRetryWorkflow: (searchId: string) => void; language: "zh" | "en"; movies: MovieItem[]; onOpenMovie: (movie: MovieItem) => void }) {
  const statusLabel = workflow.status === "running" ? (language === "en" ? "Running" : "执行中") : workflow.status === "completed" ? (language === "en" ? "Completed" : "已完成") : (language === "en" ? "Incomplete" : "未完成");
  return (
    <section className="friday-workflow" aria-live="polite">
      <div className="friday-workflow-heading">
        <strong>{language === "en" ? "Friday source verification" : "Friday 资源核验"}</strong>
        <span>{statusLabel}</span>
      </div>
      {workflow.status === "running" ? <p>{language === "en" ? "Checking sources and collecting playback evidence…" : "正在探测来源并整理片源侧证据…"}</p> : null}
      {workflow.status === "failed" ? <p>{language === "en" ? "Task incomplete: " : "任务未完整完成："}{workflow.error || (language === "en" ? "Some steps failed" : "部分步骤失败")}</p> : null}
      {workflow.status === "failed" && workflow.retryable ? (
        <button type="button" className="friday-tool-btn" onClick={() => onRetryWorkflow(searchId)}>
          {language === "en" ? "Retry failed steps" : "重试失败步骤"}
        </button>
      ) : null}
      {workflow.sourceChecks ? (
        <div className="friday-workflow-block">
          <strong>{language === "en" ? `Title-source checks · ${workflow.sourceChecks.filter((item) => item.reachable).length}/${workflow.sourceChecks.length} requests succeeded` : `影片-来源探测 · ${workflow.sourceChecks.filter((item) => item.reachable).length}/${workflow.sourceChecks.length} 次解析请求成功`}</strong>
          <p>{language === "en" ? "A successful request only confirms that the source parser returned a valid result. It does not confirm playback or decoding, and this check does not measure actual playback startup speed." : "请求成功仅表示本次片源解析接口返回了有效结果，不代表播放器已成功解码或播放；本阶段不提供真实播放加载速度。"}</p>
          {workflow.sourceChecks.length ? workflow.sourceChecks.map((item) => (
            <div className="friday-workflow-row" key={item.candidateId || item.sourceId}>
              <span>{item.sourceId}</span>
              <span>{item.reachable ? (language === "en" ? "Request succeeded" : "解析请求成功") : (language === "en" ? "Check failed" : "探测失败")}{typeof item.upstreamRequestMs === "number" ? (language === "en" ? ` · upstream response wait ${Math.round(item.upstreamRequestMs)} ms / ${item.upstreamRequestCount ?? 0} requests` : ` · 上游请求等待合计 ${Math.round(item.upstreamRequestMs)} ms / ${item.upstreamRequestCount ?? 0} 次`) : ""}</span>
            </div>
          )) : <p>{language === "en" ? "No matching sources to check." : "没有可探测的匹配来源。"}</p>}
        </div>
      ) : null}
      {workflow.qualityChecks ? (
        <div className="friday-workflow-block">
          <strong>{language === "en" ? "Quality evidence" : "画质证据"}</strong>
          <p>{language === "en" ? "Manifest/segment resolution is source-side evidence. Server probe duration includes queue wait and parsing; upstream request time sums response-header waits and is not packet RTT. Decoded videoHeight is measured only during playback." : "清单/分片分辨率属于源侧证据；服务端探测总耗时包含排队等待与解析，上游请求等待是各次响应头耗时之和，并非网络层 RTT；videoHeight 只在实际播放解码后测量。"}</p>
          {workflow.qualityChecks.map((item) => (
            <div className="friday-workflow-row" key={item.candidateId || item.sourceId}>
              <span>{item.sourceId}{item.candidateId ? ` · ${item.candidateId.split(":").slice(1).join(":")}` : ""}</span>
              <span>{item.status === "resolution_detected" ? (language === "en" ? `${item.resolutionHeight}p (manifest/segment)` : `${item.resolutionHeight}P（清单/分片解析）`) : item.status === "unavailable" ? (language === "en" ? "Check failed" : "探测失败") : item.status === "resolution_unknown" ? (language === "en" ? "Checked; resolution unknown" : "已探测，分辨率未知") : (language === "en" ? "No evidence" : "未取得证据")}{typeof item.decodedVideoHeight === "number" ? (language === "en" ? ` · decoded playback ${item.decodedVideoHeight}p` : ` · 播放器解码实测 ${item.decodedVideoHeight}P`) : ""}{typeof item.probeDurationMs === "number" ? ` · ${Math.round(item.probeDurationMs)} ms（服务端总耗时）` : ""}{typeof item.upstreamRequestMs === "number" ? (language === "en" ? ` · upstream response wait ${Math.round(item.upstreamRequestMs)} ms / ${item.upstreamRequestCount ?? 0} requests` : ` · 上游响应等待 ${Math.round(item.upstreamRequestMs)} ms / ${item.upstreamRequestCount ?? 0} 次`) : ""}{item.probeResultCached ? (language === "en" ? " · cached" : " · 缓存结果") : ""}</span>
            </div>
          ))}
        </div>
      ) : null}
      {workflow.playbackRecommendations?.length ? (
        <div className="friday-workflow-block">
          <strong>{language === "en" ? "Recommended playback source" : "智能推荐播放源"}</strong>
          <p>{language === "en" ? "The recommendation uses completed source evidence. Measured resolution is preferred; when resolution is unknown, the UI says so. Open the movie details to confirm before playback." : "推荐依据为已完成的来源证据：优先选择已解析出分辨率的资源；分辨率未知时会明确标注。点击后先进入影片详情，由你确认播放。"}</p>
          {workflow.playbackRecommendations.map((recommendation) => {
            const movie = movies.find((item) => `${item.sourceKey}:${item.vodId}` === recommendation.candidateId);
            return (
              <div className="friday-workflow-row" key={recommendation.candidateId}>
                <span>
                  {recommendation.title} · {recommendation.sourceId}
                  {recommendation.selectionBasis === "measured-resolution" && recommendation.resolutionHeight
                    ? ` · ${recommendation.resolutionHeight}P`
                    : (language === "en" ? " · resolution unknown" : " · 分辨率未知")}
                  {recommendation.alternativeCount > 0
                    ? (language === "en" ? ` · ${recommendation.alternativeCount} alternatives` : ` · 另有 ${recommendation.alternativeCount} 个候选`)
                    : ""}
                </span>
                {movie ? (
                  <button type="button" className="friday-tool-btn" onClick={() => onOpenMovie(movie)}>
                    {language === "en" ? "Open recommended source" : "打开推荐资源"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {workflow.review ? (
        <div className="friday-workflow-review">
          {language === "en" ? "Review: " : "Review："}{workflow.review.accepted ? (language === "en" ? "Structure and evidence checks passed" : "结构与证据检查通过") : (language === "en" ? "Issues need attention" : "发现待处理问题")}
          · {workflow.review.candidateCount} {language === "en" ? "candidates" : "条候选"} · {workflow.review.assessmentCount} {language === "en" ? "source assessments" : "项来源评估"}
          {language === "en" ? (workflow.review.measurementCompleted ? " · Assessment complete" : " · Assessment incomplete") : (workflow.review.measurementCompleted ? " · 评估流程已完成" : " · 评估流程未完成")}{language === "en" ? (workflow.review.resolutionMeasured ? " · Resolution measured" : " · No resolution measurement") : (workflow.review.resolutionMeasured ? " · 已测得分辨率" : " · 尚未测得分辨率")}{workflow.review.findings.length ? <p>{workflow.review.findings.join(language === "en" ? ", " : "、")}</p> : null}
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
  onRetryWorkflow,
  language,
}: {
  messagesRef: RefObject<HTMLDivElement | null>;
  messages: FridayConversationEntry[];
  listening: boolean;
  busy: boolean;
  status: string;
  error?: { message?: string } | null;
  onOpenMovie: (movie: MovieItem) => void;
  onRetryWorkflow: (searchId: string) => void;
  language: "zh" | "en";
}) {
  return (
    <div ref={messagesRef} className="friday-messages">
      {messages.length === 0 ? (
        <div className="friday-welcome">
          <div className="friday-welcome-kicker">YOUR AMBIENT AI</div>
          <div className="friday-welcome-title">{language === "en" ? "Hello, I’m Friday." : "你好，我是 Friday。"}</div>
          <div className="friday-welcome-text">
            {language === "en"
              ? (listening ? "I’m listening. Tell me what you want to watch." : "Tell me what you’re looking for, or let me find better video sources.")
              : (listening ? "我正在聆听。告诉我你想看什么电影或电视剧。" : "告诉我你想看什么，或者让我帮你寻找更好的影视资源。")}
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
              <FridayMovieResults data={data} onOpen={onOpenMovie} language={language} />
              {message.workflows?.[data.searchId] ? <WorkflowSummary workflow={message.workflows[data.searchId]} searchId={data.searchId} onRetryWorkflow={onRetryWorkflow} language={language} movies={data.results} onOpenMovie={onOpenMovie} /> : null}
            </React.Fragment>
          ))}
        </React.Fragment>
      ))}

      {busy ? (
        <div className="friday-status">
          {language === "en" ? (status === "submitted" ? "Friday is receiving your message…" : "Finding titles for you…") : (status === "submitted" ? "Friday 正在接收消息…" : "正在为你寻找合适的影视资源…")}
        </div>
      ) : null}
      {error ? <div className="friday-error">{error.message || (language === "en" ? "Request failed. Please try again." : "请求失败，请稍后重试。")}</div> : null}
    </div>
  );
}
