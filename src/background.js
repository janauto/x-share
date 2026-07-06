// 后台 Service Worker：负责所有跨域网络请求（翻译 API、twimg 图片转 data URL）
// 内容脚本受页面 CORS 限制，统一走这里。

const DEFAULTS = {
  apiKey: '',
  apiBase: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  translateDefault: true,
  // 敏感内容屏蔽
  redactEnabled: false,
  redactMode: 'rules', // 'rules' | 'model'
  redactTerms: '',
  redactPII: false,
  redactImages: false,
  // 网页发布后端
  publishTarget: 'none', // 'none' | 'gist' | 'custom'
  gistToken: '',
  publishEndpoint: '',
};

const SYS_PROMPT = `你是推文翻译引擎。用户会发来一个 JSON 对象 {"texts": ["...", ...]}，把数组里每一段文本翻译成自然、口语化的简体中文。
规则：
1. @用户名、#话题标签、URL 链接、$股票代码 原样保留，不翻译；
2. 表情符号原样保留；
3. 网络用语按中文互联网习惯意译，不要生硬直译；
4. 不要添加任何解释或注释；
5. 若某段已经是中文，原样返回该段。
只返回 JSON 对象：{"translations": ["译文1", "译文2", ...]}，数组长度、顺序与输入严格一致。`;

const REDACT_PROMPT = `你是内容合规助手。用户发来 JSON 对象 {"texts": ["...", ...]}。
对每段文本，屏蔽掉在中国大陆社交平台转发时可能触发内容审核、限流或封号的敏感内容（如政治敏感的人物/事件/组织、违禁或高危词汇），把被屏蔽的字词替换成等量的 █ 字符，其余内容原样保留。
规则：
1. 只屏蔽确有风险的词句，不要过度屏蔽正常内容；
2. 被屏蔽处用 █ 覆盖，尽量与原词字数相当；
3. @用户名、#标签、链接尽量保留；
4. 不要解释、不要添加任何注释；
5. 若某段无需屏蔽，原样返回该段。
只返回 JSON 对象：{"redacted": ["处理后1", "处理后2", ...]}，数组长度、顺序与输入严格一致。`;

function getCfg() {
  return chrome.storage.local.get(DEFAULTS);
}

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'getConfig': {
          const c = await getCfg();
          const publishConfigured =
            (c.publishTarget === 'gist' && !!c.gistToken) ||
            (c.publishTarget === 'custom' && !!c.publishEndpoint);
          sendResponse({
            hasKey: !!c.apiKey,
            translateDefault: c.translateDefault !== false,
            redactEnabled: !!c.redactEnabled,
            redactMode: c.redactMode || 'rules',
            redactTerms: c.redactTerms || '',
            redactPII: !!c.redactPII,
            redactImages: !!c.redactImages,
            publishTarget: c.publishTarget || 'none',
            publishConfigured,
          });
          break;
        }
        case 'fetchImage': {
          sendResponse({ dataUrl: await fetchImageAsDataUrl(msg.url) });
          break;
        }
        case 'translate': {
          sendResponse(await translateTexts(msg.texts || []));
          break;
        }
        case 'redact': {
          sendResponse(await redactTexts(msg.texts || []));
          break;
        }
        case 'publish': {
          sendResponse(await publishHtml(msg.html || ''));
          break;
        }
        default:
          sendResponse({ error: 'unknown message type' });
      }
    } catch (e) {
      sendResponse({ error: String((e && e.message) || e) });
    }
  })();
  return true; // 异步 sendResponse
});

const IMG_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

async function fetchImageAsDataUrl(url) {
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) throw new Error(`图片下载失败 ${resp.status}`);
  // 不能信任远端 Content-Type：它会原样进 data URL，再进网页 <img src>，
  // 带引号/尖括号的构造串可越权注入。只接受白名单 MIME，否则退回 jpeg。
  const raw = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const contentType = IMG_MIME.includes(raw) ? raw : 'image/jpeg';
  const buf = await resp.arrayBuffer();
  return `data:${contentType};base64,${arrayBufferToBase64(buf)}`;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// 通用 LLM 批处理：sysPrompt 决定任务，outKey 是返回 JSON 里的数组字段名
async function llmBatch(texts, sysPrompt, outKey, temperature) {
  const c = await getCfg();
  if (!c.apiKey) return { error: 'NO_KEY' };

  let resp;
  try {
    resp = await fetch(`${c.apiBase.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.apiKey}`,
      },
      body: JSON.stringify({
        model: c.model,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: JSON.stringify({ texts }) },
        ],
        response_format: { type: 'json_object' },
        temperature: temperature,
        stream: false,
      }),
    });
  } catch (e) {
    return { error: `请求失败：${(e && e.message) || e}` };
  }

  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 200);
    return { error: `API ${resp.status}：${detail}` };
  }

  const data = await resp.json();
  const content = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch (_) { /* 落到下面的错误 */ }
    }
  }
  const arr = parsed && (parsed[outKey] || parsed.texts);
  if (!Array.isArray(arr)) return { error: '结果解析失败' };
  return { arr: arr.map((x) => String(x)) };
}

async function translateTexts(texts) {
  if (!texts.length) return { translations: [] };
  const r = await llmBatch(texts, SYS_PROMPT, 'translations', 1.3);
  return r.error ? r : { translations: r.arr };
}

async function redactTexts(texts) {
  if (!texts.length) return { redacted: [] };
  const r = await llmBatch(texts, REDACT_PROMPT, 'redacted', 0.2);
  return r.error ? r : { redacted: r.arr };
}

// 把网页 HTML 发布到配置的后端，返回 { url } 或 { error }
async function publishHtml(html) {
  if (!html) return { error: '没有内容可发布' };
  const c = await getCfg();
  if (c.publishTarget === 'gist') return publishGist(html, c.gistToken);
  if (c.publishTarget === 'custom') return publishCustom(html, c.publishEndpoint);
  return { error: '未配置发布后端（设置页里选 Gist 或自定义服务器）' };
}

// GitHub Gist：单次带 token 的 POST，无需服务器。返回 gistpreview 渲染链接。
// 注意：gist / *.github.io 在中国大陆多不可访问，适合非墙内接收者或存档。
async function publishGist(html, token) {
  if (!token) return { error: '未填写 GitHub Token' };
  let resp;
  try {
    resp = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        public: false,
        description: 'X 转发网页',
        files: { 'index.html': { content: html } },
      }),
    });
  } catch (e) {
    return { error: `Gist 请求失败：${(e && e.message) || e}` };
  }
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 200);
    return { error: `Gist API ${resp.status}：${detail}` };
  }
  const data = await resp.json();
  if (!data.id) return { error: 'Gist 返回异常' };
  return { url: `https://gistpreview.github.io/?${data.id}`, rawUrl: data.html_url };
}

// 自定义服务器：POST 到用户配置的端点，期望返回 { url }。
// 需在 manifest.json host_permissions 里加上该端点域名（否则会被 CORS/权限拦截）。
async function publishCustom(html, endpoint) {
  if (!endpoint) return { error: '未填写自定义服务器地址' };
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html }),
    });
  } catch (e) {
    return { error: `发布请求失败（是否已在 manifest host_permissions 加该域名？）：${(e && e.message) || e}` };
  }
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 200);
    return { error: `服务器 ${resp.status}：${detail}` };
  }
  let data = null;
  try { data = await resp.json(); } catch (_) { /* 下面处理 */ }
  if (!data || !data.url) return { error: '服务器未返回 { url }' };
  return { url: data.url };
}
