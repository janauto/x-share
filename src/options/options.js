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
};

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.className = ok ? 'ok' : 'err';
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

$('save').addEventListener('click', save);
$('test').addEventListener('click', test);
load();
