import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: '请求体必须是合法 JSON' }, { status: 400 });
    }

    const { messages } = body;
    const apiKey = process.env.ZHIPU_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: '未配置 ZHIPU_API_KEY' }, { status: 500 });
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages 必须为非空数组' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;

    try {
      response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'glm-4-flash',
          messages: messages,
          temperature: 0.7,
          max_tokens: 1000
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `请求失败，状态码：${response.status}`);
    }

    if (!data.choices || data.choices.length === 0 || !data.choices[0]?.message?.content) {
      throw new Error('AI 返回数据格式异常');
    }

    return NextResponse.json({ reply: data.choices[0].message.content });
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return NextResponse.json({ error: '请求超时，请重试' }, { status: 504 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: '未知系统错误' }, { status: 500 });
  }
}
