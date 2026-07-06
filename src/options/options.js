const DEFAULTS = {
  apiKey: '',
  apiBase: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  translateDefault: true,
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
}

async function save() {
  await chrome.storage.local.set({
    apiKey: $('apiKey').value.trim(),
    apiBase: $('apiBase').value.trim() || DEFAULTS.apiBase,
    model: $('model').value.trim() || DEFAULTS.model,
    translateDefault: $('translateDefault').checked,
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
