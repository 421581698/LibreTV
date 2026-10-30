export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    let { messages, action } = await request.json();
    const apiKey = env.ZHIPU_API_KEY;
    if (!apiKey) throw new Error("Missing ZHIPU_API_KEY.");

    // 保护 system 消息的安全裁剪
    if (messages && Array.isArray(messages) && messages.length > 12) {
      const systemMsgs = messages.filter(m => m.role === 'system');
      const chatMsgs = messages.filter(m => m.role !== 'system').slice(-8);
      messages = [...systemMsgs, ...chatMsgs];
    }

    if (action && action !== 'fetch_sources') {
        return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
    }

    if (action === 'fetch_sources' && (!messages || messages.length === 0)) {
        return new Response(JSON.stringify({ error: 'Invalid messages' }), { status: 400 });
    }

    const tools = [
      { type: "function", function: { name: "search_movie", description: "搜索电影。", parameters: { type: "object", properties: { keyword: { type: "string" } }, required: ["keyword"] } } },
      { type: "function", function: { name: "update_api_config", description: "修改全局 API 配置。", parameters: { type: "object", properties: { api_url: { type: "string" } }, required: ["api_url"] } } },
      { type: "function", function: { name: "fetch_and_add_source", description: "当用户要求找新接口、新源时调用此函数。", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "add_video_source", description: "将选好的视频源写入系统。", parameters: { type: "object", properties: { name: { type: "string" }, api_url: { type: "string" } }, required: ["name", "api_url"] } } }
    ];

    let finalMessages = [...messages];
    let systemPrompt = '你是管家。用户要搜电影调用 search_movie。若要找新源，调用 fetch_and_add_source。';
    
    if (action === 'fetch_sources') {
      let githubData = [];
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      try {
        const ghRes = await fetch('https://raw.githubusercontent.com/gaotianliuyun/gao/master/js.json', {
          signal: controller.signal 
        });
        if (!ghRes.ok) throw new Error(`GitHub HTTP ${ghRes.status}`);
        const data = await ghRes.json();
        githubData = data.sites.slice(0, 10).map(s => ({ name: s.name, api: s.api }));
      } catch (e) {
        console.warn("Github拉取失败或超时", e);
      } finally {
        clearTimeout(timeoutId);
      }

      const recentChat = finalMessages.filter(m => m.role !== 'system').slice(-6);
      const globalSystem = finalMessages.filter(m => m.role === 'system' && !m.content.includes('系统为你抓取到')); 
      
      finalMessages = [
        ...globalSystem,
        ...recentChat,
        { 
          role: 'system', 
          content: githubData.length > 0 
            ? `系统为你抓取到以下源列表，请立刻调用 add_video_source 挑选一个添加，绝对不要回复多余的话：${JSON.stringify(githubData)}`
            : '系统抓取源失败，请告诉用户网络不佳。'
        }
      ];
      systemPrompt = '你正在执行自动添加源的任务，必须直接调用 add_video_source。';
    }

    const finalTools = action === 'fetch_sources' ? tools.filter(t => t.function.name !== 'fetch_and_add_source') : tools;

    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({
        model: 'glm-4-flash', 
        messages: [ { role: 'system', content: systemPrompt }, ...finalMessages ],
        tools: finalTools,
        stream: true
      })
    });

    if (!response.ok) {
        const errText = await response.text();
        return new Response(JSON.stringify({ error: `上游 API 报错: ${errText}` }), { status: response.status, headers: { 'Content-Type': 'application/json' } });
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        const errData = await response.text();
        return new Response(JSON.stringify({ error: `API 返回了 JSON 错误: ${errData}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    return newResponse;

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
