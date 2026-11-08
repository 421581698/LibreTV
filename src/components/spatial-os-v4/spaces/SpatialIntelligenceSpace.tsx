'use client';

import { SpatialTaskAuditPanel } from './SpatialTaskAuditPanel';

export function SpatialIntelligenceSpace() {
  const openFriday = () => window.dispatchEvent(new CustomEvent('friday-home-open-panel'));

  return (
    <section className="spatial-v4-space-content" aria-labelledby="spatial-intelligence-title">
      <div className="spatial-v4-space-heading">
        <p className="spatial-v4-space-eyebrow">INTELLIGENCE WORKSPACE</p>
        <h1 id="spatial-intelligence-title">智能工作台</h1>
        <p>沿用现有 Friday 对话、影视 Agent、任务事件与语音生命周期。这里负责进入工作流，不另建一套 AI 或语音运行时。</p>
      </div>
      <div className="spatial-v4-intelligence-card">
        <div>
          <span className="spatial-v4-card-kicker">FRIDAY ASSISTANT</span>
          <h2>继续与 Friday 对话</h2>
          <p>影视搜索、播放控制、语音输入和任务恢复仍由现有 Friday 模块执行。</p>
        </div>
        <div className="spatial-v4-intelligence-actions">
          <button type="button" className="spatial-v4-action-button" onClick={openFriday}>打开 Friday</button>
        </div>
      </div>
      <SpatialTaskAuditPanel />
      <div className="spatial-v4-capability-grid">
        <article><strong>影视 Agent</strong><span>搜索、资源候选、审核与播放工作流</span></article>
        <article><strong>任务运行时</strong><span>任务状态、事件记录、检查点与安全恢复</span></article>
        <article><strong>语音交互</strong><span>ASR、TTS、VAD 与打断继续沿用现有控制器</span></article>
      </div>
    </section>
  );
}
