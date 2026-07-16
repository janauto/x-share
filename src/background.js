// 后台 Service Worker：负责所有跨域网络请求（翻译 API、twimg 图片转 data URL）
// 内容脚本受页面 CORS 限制，统一走这里。
//
// DEFAULTS / normalizeConfig 从 shared/config-schema.js 引入（DEFAULTS 唯一来源）。
// importScripts 路径相对本 worker（src/background.js）所在目录解析，即 src/shared/。

importScripts('shared/config-schema.js');
importScripts('shared/cdp.js');
const { DEFAULTS, normalizeConfig, txdocsPasteKeySequence } = globalThis.__XS;

const UPDATE_REPO = {
  owner: 'janauto',
  repo: 'x-share',
  branch: 'main',
  repoUrl: 'https://github.com/janauto/x-share',
};
const UPDATE_ALARM_NAME = 'xShareUpdateCheck';
const MIN_UPDATE_INTERVAL_HOURS = 1;

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

chrome.runtime.onInstalled.addListener(() => {
  setupUpdateAlarm();
  checkForUpdates({ silent: true });
});

chrome.runtime.onStartup.addListener(() => {
  setupUpdateAlarm();
  refreshUpdateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM_NAME) checkForUpdates({ silent: true });
});

// 表驱动 handler 注册：每个 handler 返回其领域结果（形状与旧 switch 一致），
// 统一在外层做 try/catch → { error }。新增/改动消息只需在此表增删。
const HANDLERS = {
  // 归一化后的 content 侧 cfg（含 publishConfigured）
  getConfig: async () => normalizeConfig(await getCfg()),

  // 批量抓图：一条消息多 URL，逐 URL 失败填 null，不让单张失败拖垮整批
  fetchImages: async (msg) => ({
    dataUrls: await Promise.all(
      (msg.urls || []).map((u) => fetchImageAsDataUrl(u).catch(() => null))
    ),
  }),
  // 单张抓图（旧协议）：content 侧管线切到批量 fetchImages 后即无调用方，保留仅为兼容
  fetchImage: async (msg) => ({ dataUrl: await fetchImageAsDataUrl(msg.url) }),

  translate: (msg) => translateTexts(msg.texts || []),
  redact: (msg) => redactTexts(msg.texts || []),
  publish: (msg) => publishHtml(msg.html || ''),

  getUpdateStatus: () => getUpdateStatus(),
  checkUpdate: () => checkForUpdates({ silent: false }),
  setUpdateCheckEnabled: async (msg) => {
    await chrome.storage.local.set({ updateCheckEnabled: !!msg.enabled });
    await setupUpdateAlarm();
    if (!msg.enabled) await setUpdateBadge(false);
    return getUpdateStatus();
  },

  // ---- CDP 受信输入（腾讯文档全自动粘贴）----
  // 原理：chrome.debugger（CDP）注入的按键 isTrusted=true，会触发真实的系统
  // 剪贴板粘贴，绕过 docs.qq.com 编辑器对合成事件的 isTrusted 过滤。
  // 代价：attach 期间 Chrome 会显示「"X 转发卡片"正在调试此浏览器」横幅，属预期。
  // debugger 权限是 optional_permissions，由设置页的「腾讯文档全自动粘贴」开关按需请求。
  txdocsCanTrustedPaste: async () => ({
    granted: await chrome.permissions.contains({ permissions: ['debugger'] }),
  }),

  txdocsTrustedPaste: async (_msg, sender) => {
    const tabId = sender && sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') return { error: 'NO_TAB' };
    const granted = await chrome.permissions.contains({ permissions: ['debugger'] });
    if (!granted || !chrome.debugger) return { error: 'NO_PERMISSION' };
    return txdocsTrustedPasteViaCdp(tabId);
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = msg && HANDLERS[msg.type];
  (async () => {
    try {
      if (!handler) { sendResponse({ error: 'unknown message type' }); return; }
      sendResponse(await handler(msg, sender));
    } catch (e) {
      sendResponse({ error: String((e && e.message) || e) });
    }
  })();
  return true; // 异步 sendResponse
});

// ---- chrome.debugger 是回调 API，包一层 Promise（统一检查 chrome.runtime.lastError） ----

function debuggerAttach(target, version) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, version, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function debuggerDetach(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach(target, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function debuggerSendCommand(target, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// attach → 按平台发 ⌘V / Ctrl+V（rawKeyDown + keyUp，见 shared/cdp.js）→ 等
// 页面消化粘贴（150ms）→ detach。任何一步失败都 detach 兜底并返回 { error }。
async function txdocsTrustedPasteViaCdp(tabId) {
  const target = { tabId };
  let attached = false;
  try {
    await debuggerAttach(target, '1.3');
    attached = true;
    const events = txdocsPasteKeySequence(self.navigator.userAgent);
    for (const ev of events) {
      await debuggerSendCommand(target, 'Input.dispatchKeyEvent', ev);
    }
    await sleep(150);
    await debuggerDetach(target);
    attached = false;
    return { ok: true };
  } catch (e) {
    if (attached) {
      try { await debuggerDetach(target); } catch (_) { /* 兜底 detach 失败可忽略 */ }
    }
    return { error: String((e && e.message) || e) };
  }
}

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
  // CloudBase 复用 custom 的「POST {html} → 期望返回 {url}」协议，只是端点是云函数 HTTP 地址
  if (c.publishTarget === 'custom' || c.publishTarget === 'cloudbase') return publishCustom(html, c.publishEndpoint);
  return { error: '未配置发布后端（设置页里选 Gist / 自定义服务器 / 腾讯云 CloudBase）' };
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

async function setupUpdateAlarm() {
  const c = await getCfg();
  await chrome.alarms.clear(UPDATE_ALARM_NAME);
  if (c.updateCheckEnabled === false) return;
  const periodInMinutes = Math.max(
    MIN_UPDATE_INTERVAL_HOURS,
    Number(c.updateCheckIntervalHours) || DEFAULTS.updateCheckIntervalHours
  ) * 60;
  chrome.alarms.create(UPDATE_ALARM_NAME, {
    delayInMinutes: 2,
    periodInMinutes,
  });
}

async function getUpdateStatus() {
  const c = await getCfg();
  const stored = await chrome.storage.local.get({
    updateStatus: null,
    updateCheckEnabled: c.updateCheckEnabled !== false,
  });
  const status = stored.updateStatus || {};
  return {
    enabled: stored.updateCheckEnabled !== false,
    currentVersion: chrome.runtime.getManifest().version,
    repoUrl: UPDATE_REPO.repoUrl,
    branch: UPDATE_REPO.branch,
    ...status,
  };
}

async function checkForUpdates({ silent } = { silent: true }) {
  const c = await getCfg();
  if (c.updateCheckEnabled === false && silent) {
    await setUpdateBadge(false);
    return getUpdateStatus();
  }

  const currentVersion = chrome.runtime.getManifest().version;
  const checkedAt = new Date().toISOString();

  try {
    const latest = await fetchLatestGithubState(c.updateGithubToken || '');
    const hasUpdate = compareVersions(latest.version, currentVersion) > 0;
    const status = {
      ok: true,
      hasUpdate,
      currentVersion,
      latestVersion: latest.version,
      latestCommit: latest.commit,
      latestCommitUrl: latest.commitUrl,
      checkedAt,
      error: '',
    };
    await chrome.storage.local.set({ updateStatus: status });
    await setUpdateBadge(hasUpdate);
    return await getUpdateStatus();
  } catch (e) {
    const status = {
      ok: false,
      hasUpdate: false,
      currentVersion,
      checkedAt,
      error: String((e && e.message) || e),
    };
    await chrome.storage.local.set({ updateStatus: status });
    if (!silent) await setUpdateBadge(false);
    return await getUpdateStatus();
  }
}

async function fetchLatestGithubState(token) {
  const manifestUrl = `https://api.github.com/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/contents/manifest.json?ref=${UPDATE_REPO.branch}`;
  const commitUrl = `https://api.github.com/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/commits/${UPDATE_REPO.branch}`;
  const headers = githubHeaders(token);

  const [manifestResp, commitResp] = await Promise.all([
    fetch(manifestUrl, { headers }),
    fetch(commitUrl, { headers }),
  ]);

  if (!manifestResp.ok) throw new Error(githubError('manifest', manifestResp.status));
  if (!commitResp.ok) throw new Error(githubError('commit', commitResp.status));

  const manifestData = await manifestResp.json();
  const manifestText = decodeGithubContent(manifestData.content || '');
  const latestManifest = JSON.parse(manifestText);
  if (!latestManifest.version) throw new Error('GitHub manifest 未包含 version');

  const commitData = await commitResp.json();
  return {
    version: String(latestManifest.version),
    commit: String(commitData.sha || '').slice(0, 7),
    commitUrl: commitData.html_url || UPDATE_REPO.repoUrl,
  };
}

function githubHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function githubError(target, status) {
  if (status === 404) return `GitHub ${target} 404：仓库可能是私有/受限访问，请在设置页填写有读取权限的 GitHub Token`;
  if (status === 403) return `GitHub ${target} 403：请求被限流或 Token 权限不足`;
  return `GitHub ${target} ${status}`;
}

function decodeGithubContent(content) {
  const normalized = String(content).replace(/\s/g, '');
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseVersion(version) {
  return String(version)
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((num) => (Number.isFinite(num) ? num : 0));
}

async function refreshUpdateBadge() {
  const status = await getUpdateStatus();
  await setUpdateBadge(!!status.hasUpdate);
}

async function setUpdateBadge(hasUpdate) {
  await chrome.action.setBadgeText({ text: hasUpdate ? 'NEW' : '' });
  if (hasUpdate) {
    await chrome.action.setBadgeBackgroundColor({ color: '#f4212e' });
  }
}
