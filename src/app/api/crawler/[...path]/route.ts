import { NextResponse } from 'next/server';
import {
  isAuthDisabled,
  isPasswordConfigured,
  sessionFromCookieHeader,
} from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function errorResponse(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function isAllowedPath(path: string[], method: string): boolean {
  const joined = path.join('/');
  if (method === 'GET') {
    return (
      joined === 'capabilities' ||
      joined === 'candidates' ||
      (path[0] === 'candidates' && path.length === 2) ||
      joined === 'workflows' ||
      (path[0] === 'workflows' && path.length === 2) ||
      (path[0] === 'workflows' && path.length === 3 && path[2] === 'events') ||
      (path[0] === 'jobs' && path.length === 2) ||
      (path[0] === 'jobs' && path.length === 3 && path[2] === 'events')
    );
  }
  if (method === 'POST') {
    return (
      joined === 'workflows' ||
      joined === 'jobs' ||
      (path[0] === 'jobs' &&
        path.length === 3 &&
        ['pause', 'resume', 'cancel'].includes(path[2]))
    );
  }
  return false;
}

async function proxy(
  request: Request,
  context: RouteContext,
  method: 'GET' | 'POST',
) {
  if (!isAuthDisabled()) {
    if (!isPasswordConfigured()) {
      return errorResponse('服务端尚未配置访问密码。', 503);
    }
    if (!sessionFromCookieHeader(request.headers.get('cookie'))) {
      return errorResponse('需要先登录才能访问智能爬虫控制台。', 401);
    }
  }

  const engineUrl = process.env.SCRAPLING_ENGINE_URL;
  const engineKey = process.env.SCRAPLING_ENGINE_API_KEY;
  if (!engineUrl || !engineKey) {
    return errorResponse('智能爬虫引擎尚未配置连接地址或服务密钥。', 503);
  }

  if (
    !path.length ||
    path.some((segment) => !/^[a-zA-Z0-9_-]+$/.test(segment)) ||
    !isAllowedPath(path, method)
  ) {
    return errorResponse('不允许访问该爬虫引擎接口。', 404);
  }

  let target: URL;
  try {
    target = new URL(engineUrl);
  } catch {
    return errorResponse('智能爬虫引擎地址配置无效。', 503);
  }
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  ) {
    return errorResponse('智能爬虫引擎地址必须是有效的 HTTP(S) 服务地址。', 503);
  }

  const basePath = target.pathname.replace(/\/+$/, '');
  target.pathname = `${basePath}/v1/${path.join('/')}`;
  target.search = '';
  if (method === 'GET') {
    const incoming = new URL(request.url);
    for (const key of ['status', 'limit', 'last_event_id']) {
      const value = incoming.searchParams.get(key);
      if (value !== null) target.searchParams.set(key, value);
    }
  }

  const headers = new Headers({
    'X-API-Key': engineKey,
    Accept: request.headers.get('accept') || 'application/json',
  });
  let body: string | undefined;
  if (method === 'POST') {
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 1024 * 1024) {
      return errorResponse('请求体不能超过 1 MiB。', 413);
    }
    body = await request.text();
    if (body.length > 1024 * 1024) {
      return errorResponse('请求体不能超过 1 MiB。', 413);
    }
    headers.set('Content-Type', 'application/json');
  }

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      return errorResponse('爬虫引擎返回了不允许的重定向。', 502);
    }
    const responseHeaders = new Headers();
    responseHeaders.set(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json',
    );
    responseHeaders.set('Cache-Control', 'no-store');
    const eventStream = responseHeaders.get('Content-Type')?.includes('text/event-stream');
    if (eventStream) {
      responseHeaders.set('X-Accel-Buffering', 'no');
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return errorResponse('无法连接智能爬虫引擎，请检查服务状态。', 502);
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context, 'GET');
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context, 'POST');
}
