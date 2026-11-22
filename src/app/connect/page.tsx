'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type PdsResult = {
  status: 'pending' | 'ready';
  retryAfterSeconds?: number;
  masterUrl?: string;
  renditions?: Array<{ templateId: string; url: string; category: string }>;
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function ConnectPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'dash' | 'pds'>('dash');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [domainId, setDomainId] = useState('');
  const [authMode, setAuthMode] = useState<'drive' | 'share'>('drive');
  const [driveId, setDriveId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [shareId, setShareId] = useState('');
  const [shareToken, setShareToken] = useState('');
  const [fileId, setFileId] = useState('');
  const [category, setCategory] = useState<'quick_video' | 'live_transcoding' | 'offline_video'>('quick_video');
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const playUrl = (playUrl: string, mediaType: 'dash' | 'hls', fallbackTitle: string) => {
    const parsed = new URL(playUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error('播放地址必须是有效的 HTTPS 链接。');
    }
    const params = new URLSearchParams({
      source: 'manual-input',
      url: parsed.toString(),
      title: title.trim() || fallbackTitle,
      mediaType,
    });
    router.push('/watch?' + params.toString());
  };

  const submitDash = () => {
    setError('');
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        throw new Error('目前只接受 HTTPS 的 MPD 地址。');
      }
      if (!/\.mpd$/i.test(parsed.pathname)) {
        throw new Error('链接看起来不是 .mpd 清单地址；请确认你输入的是 DASH Manifest。');
      }
      playUrl(parsed.toString(), 'dash', '自定义 DASH 视频');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '播放地址无效。');
    }
  };

  const submitPds = async () => {
    setError('');
    setBusy(true);
    try {
      const payload = authMode === 'drive'
        ? { domainId: domainId.trim(), driveId: driveId.trim(), accessToken, fileId: fileId.trim(), category, templateId: templateId.trim() || undefined, urlExpireSec: 900, getMasterUrl: category === 'quick_video' }
        : { domainId: domainId.trim(), shareId: shareId.trim(), shareToken, fileId: fileId.trim(), category, templateId: templateId.trim() || undefined, urlExpireSec: 900, getMasterUrl: category === 'quick_video' };

      let result: PdsResult | null = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await fetch('/api/pds/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => ({})) as PdsResult & { error?: string };
        if (!response.ok) throw new Error(body.error || `PDS 请求失败（HTTP ${response.status}）。`);
        result = body;
        if (body.status === 'ready') break;
        if (attempt < 4) await wait(Math.max(1, body.retryAfterSeconds ?? 3) * 1000);
      }

      if (!result || result.status !== 'ready') {
        throw new Error('PDS 转码仍在处理中。请稍后重新获取播放地址。');
      }
      const rendition = [...(result.renditions ?? [])].sort((a, b) => {
        const score = (value: string) => Number(value.match(/(2160|1440|1080|720|480)/)?.[1] ?? 0);
        return score(b.templateId) - score(a.templateId);
      })[0];
      const target = result.masterUrl || rendition?.url;
      if (!target) throw new Error('PDS 已响应，但没有可用的播放地址。');
      playUrl(target, 'hls', title.trim() || 'PDS 云盘视频');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'PDS 接入失败。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <a href="/" className="text-sm text-muted hover:text-content">← 返回 LibreTV</a>
        <header className="mt-6 mb-7">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">LibreTV · External playback</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-content">资源接入</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">粘贴 DASH MPD 播放地址，或填写阿里云 PDS 文件与授权配置。获取到可播放地址后，继续使用 LibreTV 现有影院播放器。</p>
        </header>

        <div className="mb-5 grid grid-cols-2 rounded-2xl border border-line bg-card p-1">
          <button type="button" onClick={() => { setMode('dash'); setError(''); }} className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${mode === 'dash' ? 'bg-chip text-content shadow-sm' : 'text-muted'}`}>DASH / MPD 直连</button>
          <button type="button" onClick={() => { setMode('pds'); setError(''); }} className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${mode === 'pds' ? 'bg-chip text-content shadow-sm' : 'text-muted'}`}>阿里云 PDS</button>
        </div>

        <section className="rounded-2xl border border-line bg-card p-4 sm:p-6">
          {mode === 'dash' ? (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-content" htmlFor="dash-url">DASH MPD 地址</label>
                <input id="dash-url" type="url" autoComplete="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://media.example.com/manifest.mpd" className="w-full rounded-xl border border-line bg-background px-3 py-3 text-sm text-content outline-none focus:border-accent" />
                <p className="mt-2 text-xs leading-5 text-muted">需要可公开访问或你有权访问的 HTTPS MPD 地址；清单、媒体分片及跨域服务器必须允许浏览器 CORS 请求。</p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-content" htmlFor="dash-title">影片名称（可选）</label>
                <input id="dash-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：测试影片" className="w-full rounded-xl border border-line bg-background px-3 py-3 text-sm text-content outline-none focus:border-accent" />
              </div>
              <button type="button" onClick={submitDash} disabled={!url.trim()} className="btn-primary w-full disabled:opacity-50">验证地址并进入播放器</button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-content" htmlFor="pds-domain">PDS Domain ID</label>
                <input id="pds-domain" value={domainId} onChange={(event) => setDomainId(event.target.value)} placeholder="你的 PDS domain_id" className="w-full rounded-xl border border-line bg-background px-3 py-3 text-sm text-content outline-none focus:border-accent" />
              </div>
              <div className="grid grid-cols-2 rounded-xl bg-chip p-1">
                <button type="button" onClick={() => setAuthMode('drive')} className={`rounded-lg px-3 py-2 text-sm ${authMode === 'drive' ? 'bg-card text-content shadow-sm' : 'text-muted'}`}>Drive 文件</button>
                <button type="button" onClick={() => setAuthMode('share')} className={`rounded-lg px-3 py-2 text-sm ${authMode === 'share' ? 'bg-card text-content shadow-sm' : 'text-muted'}`}>分享文件</button>
              </div>
              {authMode === 'drive' ? (
                <>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-content" htmlFor="pds-drive">Drive ID</label>
                    <input id="pds-drive" value={driveId} onChange={(event) => setDriveId(event.target.value)} placeholder="drive_id" className="w-full rounded-xl border border-line bg-background px-3 py-3 text-sm text-content outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-content" htmlFor="pds-token">Access Token</label>
                    <input id="pds-token" type="password" autoComplete="off" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="粘贴短期 Access Token" className="w-full rounded-xl border border-line bg-background px-3 py-3 text-sm text-content outline-none focus:border-accent" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-content" htmlFor="pds-share">Share ID</label>
                    <input id="pds-share" value={shareId} onChange={(event) => setShareId(event.target.value)} placeholder="share_id" className="w-full rounded-xl border border-line bg-background px-3 py-3 text-sm text-content outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-content" htmlFor="pds-share-token">Share Token</label>
                    <input id="pds-share-token" type="password" autoComplete="off" value={shareToken} onChange={(event) => setShareToken(event.target.value)} placeholder="粘贴分享 Token" className="w-full rounded-xl border border-line bg-background px-3 py-3 text-sm text-content outline-none focus:border-accent" />
                  </div>
                </>
              )}
              <div>
                <label className="mb-2 block text-sm font-medium text-content" htmlFor="pds-file">File ID</label>
                <input id="pds-file" value={fileId} onChange={(event) => setFileId(event.target.value)} placeholder="file_id" className="w-full rounded-xl border border-line bg-background px-3 py-3 text-sm text-content outline-none focus:border-accent" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-content" htmlFor="pds-category">转码类型</label>
                  <select id="pds-category" value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="w-full rounded-xl border border-line bg-background px-3 py-3 text-sm text-content">
                    <option value="quick_video">Quick Video</option>
                    <option value="live_transcoding">Live Transcoding</option>
                    <option value="offline_video">Offline Video</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-content" htmlFor="pds-template">清晰度模板（可选）</label>
                  <input id="pds-template" value={templateId} onChange={(event) => setTemplateId(event.target.value)} placeholder="例如 264_1080p" className="w-full rounded-xl border border-line bg-background px-3 py-3 text-sm text-content outline-none focus:border-accent" />
                </div>
              </div>
              <button type="button" onClick={() => void submitPds()} disabled={busy || !domainId.trim() || !fileId.trim() || (authMode === 'drive' ? !driveId.trim() || !accessToken : !shareId.trim() || !shareToken)} className="btn-primary w-full disabled:opacity-50">{busy ? '正在获取播放信息…' : '连接 PDS 并进入播放器'}</button>
              <p className="text-xs leading-5 text-muted">授权信息只在本次请求中发送到当前 LibreTV 服务端，不写入 URL 或本地存储。PDS 需要预先开通对应转码能力，可能产生云服务费用。</p>
            </div>
          )}
          {error && <p role="alert" className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-3 text-sm text-red-600">{error}</p>}
        </section>
        <p className="mt-4 text-xs leading-5 text-muted">仅接入你拥有访问权限或获得授权的媒体。DASH 地址能否播放还取决于源站的 CORS、编码格式和媒体分片可访问性；PDS 接口目前返回 HLS/MP4 播放信息，并非 DASH。</p>
      </div>
    </main>
  );
}
