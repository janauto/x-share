// 后台 Service Worker：负责所有跨域网络请求（翻译 API、twimg 图片转 data URL）
// 内容脚本受页面 CORS 限制，统一走这里。

const DEFAULTS = {
  apiKey: '',
  apiBase: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  translateDefault: true,
};

const SYS_PROMPT = `你是推文翻译引擎。用户会发来一个 JSON 对象 {"texts": ["...", ...]}，把数组里每一段文本翻译成自然、口语化的简体中文。
规则：
1. @用户名、#话题标签、URL 链接、$股票代码 原样保留，不翻译；
2. 表情符号原样保留；
3. 网络用语按中文互联网习惯意译，不要生硬直译；
4. 不要添加任何解释或注释；
5. 若某段已经是中文，原样返回该段。
只返回 JSON 对象：{"translations": ["译文1", "译文2", ...]}，数组长度、顺序与输入严格一致。`;

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
          sendResponse({ hasKey: !!c.apiKey, translateDefault: c.translateDefault !== false });
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
        default:
          sendResponse({ error: 'unknown message type' });
      }
    } catch (e) {
      sendResponse({ error: String((e && e.message) || e) });
    }
  })();
  return true; // 异步 sendResponse
});

async function fetchImageAsDataUrl(url) {
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) throw new Error(`图片下载失败 ${resp.status}`);
  const contentType = resp.headers.get('content-type') || 'image/jpeg';
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

async function translateTexts(texts) {
  if (!texts.length) return { translations: [] };
  const c = await getCfg();
  if (!c.apiKey) return { error: 'NO_KEY' };

  const resp = await fetch(`${c.apiBase.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.apiKey}`,
    },
    body: JSON.stringify({
      model: c.model,
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: JSON.stringify({ texts }) },
      ],
      response_format: { type: 'json_object' },
      temperature: 1.3,
      stream: false,
    }),
  });

  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 200);
    return { error: `翻译 API ${resp.status}：${detail}` };
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
  const arr = parsed && (parsed.translations || parsed.texts);
  if (!Array.isArray(arr)) return { error: '翻译结果解析失败' };
  return { translations: arr.map((x) => String(x)) };
}
