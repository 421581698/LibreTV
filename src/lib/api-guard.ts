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

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}


/**
 * Guard for costly/private features that must never inherit a public preview's
 * AUTH_DISABLED bypass. Public pages may remain accessible, but collector
 * operations always require a password-protected session.
 */
export function guardPrivateFeatureRequest(req: Request): NextResponse | null {
  if (isAuthDisabled()) {
    return NextResponse.json(
      { error: '该功能在公开预览环境中已禁用。请在启用密码保护的环境中使用。' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return guardRequest(req);
}
