const DEFAULTS = {
  apiKey: '',
  apiBase: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  translateDefault: true,
  autoHotDefault: true,
  autoHotN: 10,
  redactEnabled: false,
  redactMode: 'rules',
  redactTerms: '',
  redactPII: false,
  redactImages: false,
  publishTarget: 'none',
  gistToken: '',
  publishEndpoint: '',
  updateCheckEnabled: true,
  updateGithubToken: '',
};

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

$('save').addEventListener('click', save);
$('test').addEventListener('click', test);
$('checkUpdate').addEventListener('click', checkUpdate);
$('updateCheckEnabled').addEventListener('change', save);
load();
