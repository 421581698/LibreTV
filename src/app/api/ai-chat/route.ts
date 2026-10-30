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
          messages: [
            {
              role: 'system',
              content: `你的名字叫“贾维斯”（Jarvis），你是用户的专属全能电影管家。\n当用户呼叫“贾维斯”或者向你问好时，请用热情、忠诚的语气回应（例如：“我在，主人，随时为您服务”）。\n${messages.find((m: any) => m.role === 'system')?.content || ''}\n请严格遵守以下规则：\n1. 【搜片指令】：如果用户想看电影，简短回复，并在末尾加上暗号：[SEARCH:提取的电影名]。\n2. 【设置指令】：如果用户想打开设置，简短回复，并在末尾加上暗号：[ACTION:OPEN_SETTINGS]。\n3. 【写代码指令】：直接输出 Markdown 代码块，不要废话。\n4. 【页面感知】：结合上面提供的网页摘要回答用户问题。\n每次只能输出一个特殊暗号。`
            },
            ...messages.filter((m: any) => m.role !== 'system')
          ],
          temperature: 0.1,
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
