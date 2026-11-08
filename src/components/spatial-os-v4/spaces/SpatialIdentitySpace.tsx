'use client';

import { useEffect, useRef, useState } from 'react';
import { exportConfig, importConfig, listFavorites, migrateLegacyLiveFavorites, removeFavorite, type FavoriteEntry } from '@/lib/db';
import { useAppStore } from '@/lib/store';

export function SpatialIdentitySpace() {
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const openHistory = () => window.dispatchEvent(new CustomEvent('libretv:open-history'));
  const openSourceSettings = () => window.dispatchEvent(new CustomEvent('libretv:open-source-settings'));
  const openFriday = () => window.dispatchEvent(new CustomEvent('friday-home-open-panel'));

  const refreshFavorites = async () => {
    try {
      setFavorites(await listFavorites());
    } catch {
      setFavorites([]);
    }
  };

  useEffect(() => {
    void refreshFavorites();
    const refresh = () => void refreshFavorites();
    window.addEventListener('libretv:favorites-changed', refresh);
    return () => window.removeEventListener('libretv:favorites-changed', refresh);
  }, []);

  const exportProfile = async () => {
    setTransferBusy(true);
    setTransferMessage('');
    try {
      const content = await exportConfig();
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'libretv-profile-' + new Date().toISOString().slice(0, 10) + '.json';
      anchor.click();
      URL.revokeObjectURL(url);
      setTransferMessage('个人资料已导出。将 JSON 文件传到另一台设备，再使用“导入个人资料”。');
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : '导出失败');
    } finally {
      setTransferBusy(false);
    }
  };

  const importProfile = async (file?: File) => {
    if (!file) return;
    setTransferBusy(true);
    setTransferMessage('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('个人资料文件不能超过 10 MB');
      const content = await file.text();
      await importConfig(content);
      await useAppStore.persist.rehydrate();
      const restored = useAppStore.getState();
      await migrateLegacyLiveFavorites(restored.liveFavorites, restored.liveRecent);
      await refreshFavorites();
      window.dispatchEvent(new CustomEvent('libretv:spatial-profile-imported'));
      setTransferMessage('个人资料导入完成。空间偏好、收藏、设置和观看历史已恢复。');
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : '导入失败，请确认文件来自 LibreTV 个人资料导出');
    } finally {
      setTransferBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const deleteFavorite = async (id: string) => {
    const favorite = favorites.find((item) => item.id === id);
    if (favorite?.kind === 'live' && typeof favorite.metadata?.streamUrl === 'string') {
      const store = useAppStore.getState();
      if (store.liveFavorites.includes(favorite.metadata.streamUrl)) store.toggleLiveFavorite(favorite.metadata.streamUrl);
    }
    await removeFavorite(id);
    await refreshFavorites();
    window.dispatchEvent(new CustomEvent('libretv:favorites-changed'));
  };

  return (
    <section className="spatial-v4-space-content" aria-labelledby="spatial-identity-title">
      <div className="spatial-v4-space-heading">
        <p className="spatial-v4-space-eyebrow">IDENTITY & PREFERENCES</p>
        <h1 id="spatial-identity-title">个人空间</h1>
        <p>集中管理 LibreTV 收藏、观看历史、数据源和个人偏好。收藏与空间状态保存在本机 IndexedDB。</p>
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

      <div className="spatial-v4-profile-transfer">
        <div>
          <h2>跨设备个人资料</h2>
          <p>导出 / 导入便携资料包，可在另一台设备恢复设置、收藏、空间偏好与观看历史。</p>
        </div>
        <div className="spatial-v4-profile-actions">
          <button type="button" className="spatial-v4-action-button" onClick={() => void exportProfile()} disabled={transferBusy}>
            {transferBusy ? '处理中…' : '导出个人资料'}
          </button>
          <button type="button" className="spatial-v4-action-button" onClick={() => fileInput.current?.click()} disabled={transferBusy}>
            导入个人资料
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="选择 LibreTV 个人资料文件"
            onChange={(event) => void importProfile(event.target.files?.[0])}
          />
        </div>
        {transferMessage ? <p className="spatial-v4-transfer-message" role="status">{transferMessage}</p> : null}
        <p className="spatial-v4-source-note">资料包由你自行保管并传输；当前版本提供本地加导入 / 导出，不会把资料上传到公共服务器，也不提供自动云端同步。Friday 对话正文与任务事件不会包含在资料包中。</p>
      </div>

      <div className="spatial-v4-favorites-section">
        <div className="spatial-v4-favorites-heading">
          <div><h2>我的收藏</h2><p>统一管理影视与 FMHY 资源收藏（{favorites.length}）</p></div>
        </div>
        {favorites.length === 0 ? <p className="spatial-v4-fmhy-message">还没有收藏内容。可在影视推荐卡片或资源宇宙中点亮星标。</p> : (
          <div className="spatial-v4-favorite-list">
            {favorites.map((favorite) => (
              <article className="spatial-v4-favorite-row" key={favorite.id}>
                {favorite.image ? <img src={favorite.image} alt="" loading="lazy" /> : <div className="spatial-v4-favorite-placeholder">★</div>}
                <div className="spatial-v4-favorite-copy">
                  <strong>{favorite.title}</strong>
                  <span>{favorite.kind === 'media' ? '影视' : favorite.category || '资源'}</span>
                </div>
                {favorite.href ? <a href={favorite.href} target="_blank" rel="noopener noreferrer">打开 ↗</a> : favorite.kind === 'media' ? <a href={'/?s=' + encodeURIComponent(favorite.title)}>查找影片</a> : null}
                <button type="button" aria-label={'移除收藏：' + favorite.title} onClick={() => void deleteFavorite(favorite.id)}>移除</button>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
