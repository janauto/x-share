// x-share 网页发布端 · 腾讯云 CloudBase 云函数（HTTP 访问服务）
//
// 协议（与扩展「自定义服务器 / CloudBase」通道一致）：
//   POST  {html}          -> 存一份 HTML，返回 { url }
//   GET   ?id=<pid>       -> 以 Content-Type: text/html 回吐这份 HTML（免登录公开可读）
//
// 为什么用云函数而不是「静态托管」：CloudBase 默认静态托管域名自 2024-01 起对 .html
// 强制下载（Content-Disposition: attachment），无法在线预览；云函数自己设 text/html 头即可绕过。
//
// 微信内稳定打开：默认 *.tcloudbase.com 域名可能走「访问提示中间页」，正式分享请在
// CloudBase 控制台给环境绑定【已备案】自定义域名，并把它设为下面的 PUBLIC_BASE 环境变量。

const tcb = require('@cloudbase/node-sdk');

const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
const db = app.database();
const COLLECTION = 'xshare_pages';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

function randId(n) {
  const s = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  for (let i = 0; i < (n || 10); i++) r += s[Math.floor(Math.random() * s.length)];
  return r;
}

// 生成公开链接的基地址：优先已备案自定义域名(PUBLIC_BASE)，否则用本次请求的 host+path
function selfBase(event) {
  if (process.env.PUBLIC_BASE) return process.env.PUBLIC_BASE.replace(/\/+$/, '') + (event.path || '');
  const h = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const path = (event.path || '').split('?')[0];
  return 'https://' + h + path;
}

function json(statusCode, obj) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj) };
}

exports.main = async (event) => {
  const method = (event.httpMethod || 'GET').toUpperCase();

  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // ---- GET ?id=xxx -> 回吐 HTML ----
  if (method === 'GET') {
    const id = event.queryStringParameters && event.queryStringParameters.id;
    if (!id) return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' }, body: '缺少 id 参数' };
    let html = '';
    try {
      const res = await db.collection(COLLECTION).where({ pid: id }).limit(1).get();
      html = res.data && res.data[0] && res.data[0].html;
    } catch (e) {
      return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' }, body: '读取失败：' + e.message };
    }
    if (!html) return { statusCode: 404, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' }, body: '页面不存在或已过期' };
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
      body: html,
    };
  }

  // ---- POST {html} -> 存储 -> 返回 {url} ----
  if (method === 'POST') {
    let raw = event.body || '';
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf-8');
    let html = '';
    try { html = (JSON.parse(raw) || {}).html || ''; } catch (_) { html = ''; }
    if (!html) return json(400, { error: '缺少 html' });
    if (html.length > 5 * 1024 * 1024) return json(413, { error: '内容过大（>5MB）' });

    const pid = randId(10);
    try {
      await db.collection(COLLECTION).add({ pid, html, createdAt: Date.now() });
    } catch (e) {
      return json(500, { error: '写入失败（请先在 CloudBase 控制台的「数据库」里新建集合 ' + COLLECTION + '）：' + e.message });
    }
    return json(200, { url: selfBase(event) + '?id=' + pid });
  }

  return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
};
