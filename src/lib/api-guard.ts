import { NextResponse } from 'next/server';
import { isAuthDisabled, isPasswordConfigured, sessionFromCookieHeader } from './auth';

/** API Route 共享守卫：未配置密码返回 503，未登录返回 401 */
export function guardRequest(req: Request): NextResponse | null {
  // 仅在明确设置 AUTH_DISABLED=true 的预览环境中开放 API；默认仍强制鉴权。
  if (isAuthDisabled()) return null;
  if (!isPasswordConfigured()) {
    return NextResponse.json(
      { error: '服务器未设置 PASSWORD 环境变量' },
      { status: 503 }
    );
  }
  if (!sessionFromCookieHeader(req.headers.get('cookie'))) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  return null;
}

/**
 * Guard for costly/private features.
 *
 * In a password-free public Preview, Collector routes may be used only when
 * the current browser explicitly supplies BOTH its own HTTPS service origin
 * and bearer token. The proxy validates the origin and token before forwarding.
 * This deliberately prevents anonymous callers from consuming server-side
 * SCRAPLING_API_TOKEN credentials through a public open proxy.
 *
 * In password-protected deployments, the normal session gate remains required
 * and server-side SCRAPLING_API_BASE / SCRAPLING_API_TOKEN fallback remains
 * available.
 */
export function guardPrivateFeatureRequest(req: Request): NextResponse | null {
  if (isAuthDisabled()) {
    const browserBase = req.headers.get('x-scrapling-api-base')?.trim() ?? '';
    const browserToken = req.headers.get('x-scrapling-api-token')?.trim() ?? '';
    if (browserBase && browserToken) return null;

    return NextResponse.json(
      {
        error: '公开预览中的资源采集仅接受当前设备填写的 HTTPS 地址和 Token。请在本机设置中保存两项后重试；匿名请求不会使用服务端 Collector 密钥。',
        code: 'BROWSER_COLLECTOR_CREDENTIALS_REQUIRED',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return guardRequest(req);
}
