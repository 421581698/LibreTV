'use client';

export function SpatialIdentitySpace() {
  const openHistory = () => window.dispatchEvent(new CustomEvent('libretv:open-history'));
  const openSourceSettings = () => window.dispatchEvent(new CustomEvent('libretv:open-source-settings'));
  const openFriday = () => window.dispatchEvent(new CustomEvent('friday-home-open-panel'));

  return (
    <section className="spatial-v4-space-content" aria-labelledby="spatial-identity-title">
      <div className="spatial-v4-space-heading">
        <p className="spatial-v4-space-eyebrow">IDENTITY & PREFERENCES</p>
        <h1 id="spatial-identity-title">个人空间</h1>
        <p>从这里管理已有的观看记录、数据源与显示偏好。现有存储仍由各自模块负责，不迁移或合并原有数据。</p>
      </div>
      <div className="spatial-v4-identity-grid">
        <article className="spatial-v4-identity-card">
          <div><h2>观看历史</h2><p>查看、搜索、删除或继续播放本地 IndexedDB 中的观看记录。</p></div>
          <button type="button" className="spatial-v4-action-button" onClick={openHistory}>打开观看历史</button>
        </article>
        <article className="spatial-v4-identity-card">
          <div><h2>数据源与订阅</h2><p>管理点播源、直播源、启用状态与源健康检查。</p></div>
          <button type="button" className="spatial-v4-action-button" onClick={openSourceSettings}>管理数据源</button>
        </article>
        <article className="spatial-v4-identity-card">
          <div><h2>Friday 偏好</h2><p>打开现有 Friday 面板，管理助手角色、语音与会话选项。</p></div>
          <button type="button" className="spatial-v4-action-button" onClick={openFriday}>Friday 设置</button>
        </article>
      </div>
      <p className="spatial-v4-source-note">说明：主题可通过顶部工具栏切换。独立收藏夹与跨设备个人资料尚未接入；此处不会伪造或覆盖这些数据。</p>
    </section>
  );
}
