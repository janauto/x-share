// DEFAULTS 来自 shared/config-schema.js（options.html 里先于本脚本 <script> 引入）。
const DEFAULTS = window.__XS.DEFAULTS;

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const updateStatusEl = $('updateStatus');

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.className = ok ? 'ok' : 'err';
}

function setUpdateStatus(text, ok) {
  updateStatusEl.textContent = text;
  updateStatusEl.className = ok ? 'ok' : 'err';
}

async function load() {
  const c = await chrome.storage.local.get(DEFAULTS);
  $('apiKey').value = c.apiKey;
  $('apiBase').value = c.apiBase;
  $('model').value = c.model;
  $('translateDefault').checked = c.translateDefault !== false;
  $('autoHotDefault').checked = c.autoHotDefault !== false;
  $('autoHotN').value = c.autoHotN || 10;
  $('redactEnabled').checked = !!c.redactEnabled;
  $('redactMode').value = c.redactMode || 'rules';
  $('redactTerms').value = c.redactTerms || '';
  $('redactPII').checked = !!c.redactPII;
  $('redactImages').checked = !!c.redactImages;
  $('publishTarget').value = c.publishTarget || 'none';
  $('gistToken').value = c.gistToken || '';
  $('publishEndpoint').value = c.publishEndpoint || '';
  $('txdocsAutoPaste').checked = !!c.txdocsAutoPaste;
  $('updateCheckEnabled').checked = c.updateCheckEnabled !== false;
  $('updateGithubToken').value = c.updateGithubToken || '';
  await renderUpdateStatus();
}

async function save() {
  await chrome.storage.local.set({
    apiKey: $('apiKey').value.trim(),
    apiBase: $('apiBase').value.trim() || DEFAULTS.apiBase,
    model: $('model').value.trim() || DEFAULTS.model,
    translateDefault: $('translateDefault').checked,
    autoHotDefault: $('autoHotDefault').checked,
    autoHotN: Math.min(20, Math.max(1, parseInt($('autoHotN').value, 10) || 10)),
    redactEnabled: $('redactEnabled').checked,
    redactMode: $('redactMode').value,
    redactTerms: $('redactTerms').value,
    redactPII: $('redactPII').checked,
    redactImages: $('redactImages').checked,
    publishTarget: $('publishTarget').value,
    gistToken: $('gistToken').value.trim(),
    publishEndpoint: $('publishEndpoint').value.trim(),
    updateCheckEnabled: $('updateCheckEnabled').checked,
    updateGithubToken: $('updateGithubToken').value.trim(),
  });
  await chrome.runtime.sendMessage({
    type: 'setUpdateCheckEnabled',
    enabled: $('updateCheckEnabled').checked,
  });
  setStatus('已保存 ✓', true);
}

async function test() {
  await save();
  setStatus('测试中…', true);
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'translate',
      texts: ['Hello! This is a connectivity test.'],
    });
    if (resp && resp.translations && resp.translations[0]) {
      setStatus(`翻译正常 ✓ →「${resp.translations[0]}」`, true);
    } else {
      setStatus((resp && resp.error === 'NO_KEY' ? '请先填写 API Key' : (resp && resp.error) || '未知错误'), false);
    }
  } catch (e) {
    setStatus(String((e && e.message) || e), false);
  }
}

async function renderUpdateStatus(status) {
  const data = status || await chrome.runtime.sendMessage({ type: 'getUpdateStatus' });
  $('currentVersion').textContent = data.currentVersion || '-';
  $('latestVersion').textContent = data.latestVersion || '-';
  $('latestCommit').innerHTML = data.latestCommitUrl && data.latestCommit
    ? `<a href="${escapeAttr(data.latestCommitUrl)}" target="_blank" rel="noreferrer">${escapeHtml(data.latestCommit)}</a>`
    : (data.latestCommit || '-');
  $('checkedAt').textContent = data.checkedAt ? formatTime(data.checkedAt) : '尚未检查';
  $('openRepo').href = data.repoUrl || 'https://github.com/janauto/x-share';

  if (data.error) {
    $('updateSummary').innerHTML = `<span class="badge warn">失败</span> ${escapeHtml(data.error)}`;
    return;
  }
  if (!data.latestVersion) {
    $('updateSummary').innerHTML = '<span class="badge">待检查</span>';
    return;
  }
  if (data.hasUpdate) {
    $('updateSummary').innerHTML = '<span class="badge warn">发现新版本</span> 去 GitHub 拉取后，在扩展页刷新。';
    return;
  }
  $('updateSummary').innerHTML = '<span class="badge ok">已是最新</span>';
}

async function checkUpdate() {
  setUpdateStatus('检查中…', true);
  try {
    const status = await chrome.runtime.sendMessage({ type: 'checkUpdate' });
    await renderUpdateStatus(status);
    if (status && status.error) {
      setUpdateStatus(status.error, false);
    } else if (status && status.hasUpdate) {
      setUpdateStatus(`发现新版本 ${status.latestVersion}`, false);
    } else {
      setUpdateStatus('已是最新 ✓', true);
    }
  } catch (e) {
    setUpdateStatus(String((e && e.message) || e), false);
  }
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

// 腾讯文档全自动粘贴：勾选即请求 debugger 可选权限（须在用户手势里调），
// 拒绝则回退未勾选；取消勾选则移除权限。状态持久化在 storage key txdocsAutoPaste，
// 不进 save()（该开关即改即存，避免「保存」按钮把权限状态搞拧）。
async function toggleTxdocsAutoPaste() {
  const el = $('txdocsAutoPaste');
  if (el.checked) {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ permissions: ['debugger'] });
    } catch (e) {
      granted = false;
    }
    if (!granted) {
      el.checked = false;
      await chrome.storage.local.set({ txdocsAutoPaste: false });
      setStatus('未获得「调试浏览器」权限，全自动粘贴保持关闭', false);
      return;
    }
    await chrome.storage.local.set({ txdocsAutoPaste: true });
    setStatus('已开启腾讯文档全自动粘贴 ✓', true);
  } else {
    try {
      await chrome.permissions.remove({ permissions: ['debugger'] });
    } catch (e) { /* 权限本就不在时忽略 */ }
    await chrome.storage.local.set({ txdocsAutoPaste: false });
    setStatus('已关闭腾讯文档全自动粘贴，权限已移除 ✓', true);
  }
}

$('save').addEventListener('click', save);
$('test').addEventListener('click', test);
$('checkUpdate').addEventListener('click', checkUpdate);
$('updateCheckEnabled').addEventListener('change', save);
$('txdocsAutoPaste').addEventListener('change', toggleTxdocsAutoPaste);
load();
