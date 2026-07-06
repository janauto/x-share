#!/usr/bin/env node
// -----------------------------------------------------------------------------
// 金山文档（WPS 开放平台）个人版 API 验证 harness
//
// 目的：等你在 open.wps.cn 拿到凭证后，一条命令验证三大未知点：
//   ① 换 / 刷新 token 是否强制后端（TK-05，静态结论）
//   ② 能否创建分享并设为「任何人可查看」（TK-03）
//   ③ 上传 / 创建的文档内容如何呈现（TK-02 + TK-04 匿名访问观察）
//
// 运行环境：Node 18+（用原生 fetch，零依赖）。本机实测 Node 22 亦可。
//
// 用法：
//   KDOCS_ACCESS_TOKEN=xxxxx node scripts/kdocs-api-test.mjs
//   （access_token 需你在服务端用 app_id + app_key 走 OAuth 换取后填入，
//     原因见 TK-05 —— 官方要求换 token 必须在服务器端进行。）
//
// 每个请求上方都标注了所依据的官方文档 URL。文档没写清、需运行时探测的
// 参数用 `TODO(doc-gap)` 标注；请求返回 4xx 时会打印服务器原始错误消息帮助定位。
// -----------------------------------------------------------------------------

'use strict';

// ---- 常量：官方文档里给出的主机与 OpenAPI 前缀 ----
// 文档：https://developer.kdocs.cn/common/authorization/web.html
//       https://developer.kdocs.cn/server/guide/api-overview.html
const HOST = 'https://developer.kdocs.cn';
const API = `${HOST}/api/v1/openapi`;

// ---- 环境变量 ----
const ACCESS_TOKEN = process.env.KDOCS_ACCESS_TOKEN || '';
// 可选：如果你只想测「上传文件」而不测「创建空白文档」，或反过来，用这个开关。
// 默认两种都探（doc 里 create-files 与 upload-local-files 是两个独立端点）。
const PROBE_MODE = (process.env.KDOCS_PROBE || 'both').toLowerCase(); // both | create | upload

// ---- 结果收集 ----
const results = []; // { id, name, status: PASS|FAIL|BLOCKED, detail }
function record(id, name, status, detail) {
  results.push({ id, name, status, detail: detail || '' });
  const tag = status === 'PASS' ? '✅ PASS' : status === 'FAIL' ? '❌ FAIL' : '⏭️  BLOCKED';
  console.log(`\n[${id}] ${name} -> ${tag}`);
  if (detail) console.log('      ' + String(detail).replace(/\n/g, '\n      '));
}

// ---- 通用请求封装：JSON 请求，失败时打印服务器原始报文 ----
async function apiJson(method, url, { body, headers } = {}) {
  const opt = { method, headers: { ...(headers || {}) } };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(url, opt);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON，保留 text */ }
  return { res, json, text };
}

// 打印服务器错误细节，帮助定位文档没写清的参数
function explainHttp({ res, json, text }) {
  const codePart = json && json.code !== undefined ? ` code=${json.code}` : '';
  const msgPart = json && (json.msg || json.message) ? ` msg=${json.msg || json.message}` : '';
  const raw = (!json && text) ? ` body=${text.slice(0, 300)}` : '';
  return `HTTP ${res.status}${codePart}${msgPart}${raw}`;
}

// 把 access_token 作为 query 参数拼接（文档统一用 query 传递，而非 Authorization 头）
// 文档：https://developer.kdocs.cn/common/authorization/web.html （access_token 作为 query）
function withToken(url) {
  const u = new URL(url);
  u.searchParams.set('access_token', ACCESS_TOKEN);
  return u.toString();
}

// -----------------------------------------------------------------------------
// TK-01 凭证有效性：取用户基本信息
// 文档：https://developer.kdocs.cn/server/user/userinfo.html
//   GET /api/v1/openapi/user/basic?access_token=...
//   返回 { code:0, data:{ id:{open_id,union_id}, nickname, avatar } }
// -----------------------------------------------------------------------------
async function tk01_credential() {
  if (!ACCESS_TOKEN) {
    record('TK-01', '凭证有效性（用户信息）', 'BLOCKED', '未设置 KDOCS_ACCESS_TOKEN，无法验证');
    return false;
  }
  try {
    const r = await apiJson('GET', withToken(`${API}/user/basic`));
    if (r.res.ok && r.json && r.json.code === 0) {
      const d = r.json.data || {};
      record('TK-01', '凭证有效性（用户信息）', 'PASS',
        `nickname=${d.nickname ?? '(空)'} open_id=${d.id?.open_id ?? '?'}`);
      return true;
    }
    record('TK-01', '凭证有效性（用户信息）', 'FAIL', explainHttp(r));
    return false;
  } catch (e) {
    record('TK-01', '凭证有效性（用户信息）', 'FAIL', `异常：${e.message}`);
    return false;
  }
}

// -----------------------------------------------------------------------------
// TK-02 创建文档：两条路都探，记录哪种可用，返回 file_token（= data.id.open_id）
//
// 路 A — 创建空白文档
//   文档：https://developer.kdocs.cn/server/personal/create-files.html
//   POST /api/v1/openapi/personal/files?access_token=...
//   body: { filename:"xxx.docx", parent_id?, parent_path?, path_from_root? }
//   返回 { code:0, data:{ id:{open_id,union_id}, space } }
//
// 路 B — 上传本地文件（单步 multipart/form-data）
//   文档：https://developer.kdocs.cn/server/personal/upload-local-files.html
//   POST /api/v1/openapi/personal/files/upload?access_token=...
//   form: file=<二进制>, parent_id?/parent_path?/path_from_root?
//   返回 { code:0, data:{ id:{open_id,union_id}, space } }
//
// 说明：文档返回体给的是 data.id.open_id，后续「创建分享 / 删除」端点的 :file_token
//       路径参数即用它。文档未在返回体里显式叫 "file_token"，属 doc-gap，
//       运行时以 open_id 代入并观察分享端点是否接受。
// -----------------------------------------------------------------------------
async function tk02_createDoc() {
  if (!ACCESS_TOKEN) {
    record('TK-02', '创建文档（空白/上传）', 'BLOCKED', '未设置 KDOCS_ACCESS_TOKEN');
    return { fileToken: null, method: null };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let created = null; // { fileToken, method, filename }

  // ---- 路 A：创建空白文档 ----
  if (PROBE_MODE === 'both' || PROBE_MODE === 'create') {
    const filename = `xshare-harness-${stamp}.docx`;
    try {
      const r = await apiJson('POST', withToken(`${API}/personal/files`), {
        body: {
          filename,
          // TODO(doc-gap): parent_id / parent_path 均可选；不传时文档默认落到「我的文档」根目录，
          //   运行时若报错再补。此处故意不传以走默认目录。
        },
      });
      if (r.res.ok && r.json && r.json.code === 0) {
        const fileToken = r.json.data?.id?.open_id;
        created = { fileToken, method: '创建空白文档', filename };
        console.log(`      [路A] 创建空白文档成功 open_id=${fileToken}`);
      } else {
        console.log(`      [路A] 创建空白文档失败 ${explainHttp(r)}`);
      }
    } catch (e) {
      console.log(`      [路A] 创建空白文档异常：${e.message}`);
    }
  }

  // ---- 路 B：上传本地文件（若路 A 未成功，或显式 upload 模式）----
  if (!created && (PROBE_MODE === 'both' || PROBE_MODE === 'upload')) {
    const filename = `xshare-harness-${stamp}.txt`;
    // 造一个小文本文件内容（顺带观察 TK-04 匿名访问时呈现方式）
    const content =
      `x-share harness 上传测试\n生成时间：${stamp}\n这是用于验证匿名可查看的占位内容。\n`;
    try {
      const form = new FormData();
      // 文档字段名就是 "file"
      form.append('file', new Blob([content], { type: 'text/plain' }), filename);
      // TODO(doc-gap): parent_id / parent_path 可选，不传走默认目录。
      const res = await fetch(withToken(`${API}/personal/files/upload`), {
        method: 'POST',
        body: form, // 让 fetch 自动带 multipart boundary，勿手设 Content-Type
      });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      if (res.ok && json && json.code === 0) {
        const fileToken = json.data?.id?.open_id;
        created = { fileToken, method: '上传本地文件', filename };
        console.log(`      [路B] 上传本地文件成功 open_id=${fileToken}`);
      } else {
        console.log(`      [路B] 上传本地文件失败 ${explainHttp({ res, json, text })}`);
      }
    } catch (e) {
      console.log(`      [路B] 上传本地文件异常：${e.message}`);
    }
  }

  if (created && created.fileToken) {
    record('TK-02', '创建文档（空白/上传）', 'PASS',
      `可用方式=${created.method}，file_token=${created.fileToken}，filename=${created.filename}`);
    return { fileToken: created.fileToken, method: created.method };
  }
  record('TK-02', '创建文档（空白/上传）', 'FAIL', '两种方式均未拿到 file_token（详见上方逐条日志）');
  return { fileToken: null, method: null };
}

// -----------------------------------------------------------------------------
// TK-03 创建分享：尝试「任何人可查看」，并枚举探测权限/范围参数
// 文档：https://developer.kdocs.cn/server/personal/create-links.html
//   POST /api/v1/openapi/personal/files/:file_token/links?access_token=...
//   body 关键字段（来自文档）：
//     range: "anyone"（任何人）           <- 控制「谁能访问」
//     permission: "read"(浏览) | "write"(编辑)
//     status: "open"（默认，任何人）| "close"（仅指定人）
//     ext_perm_list: ["comment"]（可选）
//     period: 0(永久)|7|30（可选，天）
//     reset: true|false（可选）
//   返回 { code:0, data:{ link_url, sid, link_permission, expire_time, filename, ext_perm_list } }
//
// 目标组合 =「任何人可查看」= range:"anyone" + permission:"read" + status:"open"
// -----------------------------------------------------------------------------
async function tk03_createShare(fileToken) {
  if (!ACCESS_TOKEN) {
    record('TK-03', '创建分享（任何人可查看）', 'BLOCKED', '未设置 KDOCS_ACCESS_TOKEN');
    return { linkUrl: null, sid: null };
  }
  if (!fileToken) {
    record('TK-03', '创建分享（任何人可查看）', 'BLOCKED', 'TK-02 未产出 file_token');
    return { linkUrl: null, sid: null };
  }

  const url = withToken(`${API}/personal/files/${encodeURIComponent(fileToken)}/links`);
  // 主尝试：任何人可查看
  const primaryBody = {
    range: 'anyone',
    permission: 'read',
    status: 'open',
    period: 0, // 永久，便于事后手动复核；如需限时改成 7 / 30
    // TODO(doc-gap): reset 默认 false；若该文档已存在分享导致冲突，下方降级会带 reset:true 重试。
  };

  try {
    let r = await apiJson('POST', url, { body: primaryBody });

    // 若首次冲突（已存在分享等），带 reset:true 再试一次
    if (!(r.res.ok && r.json && r.json.code === 0)) {
      console.log(`      主尝试未成功：${explainHttp(r)}；带 reset:true 重试`);
      r = await apiJson('POST', url, { body: { ...primaryBody, reset: true } });
    }

    if (r.res.ok && r.json && r.json.code === 0) {
      const d = r.json.data || {};
      record('TK-03', '创建分享（任何人可查看）', 'PASS',
        `接受参数 range=anyone permission=read status=open；` +
        `link_url=${d.link_url} sid=${d.sid} link_permission=${d.link_permission}`);
      return { linkUrl: d.link_url || null, sid: d.sid || null };
    }

    // 失败：把服务器报文如实抛出，方便判断哪个 enum 不被接受
    record('TK-03', '创建分享（任何人可查看）', 'FAIL',
      `range=anyone/permission=read/status=open 被拒：${explainHttp(r)}`);
    return { linkUrl: null, sid: null };
  } catch (e) {
    record('TK-03', '创建分享（任何人可查看）', 'FAIL', `异常：${e.message}`);
    return { linkUrl: null, sid: null };
  }
}

// -----------------------------------------------------------------------------
// TK-04 匿名验证：对分享链接做无凭证 fetch，断言 200 + 非登录页 + 可见标题
//   —— 纯客户端视角，不带任何 access_token / cookie。
//   —— 若最终 URL 落到登录/授权页，或页面出现「登录/login」关键字，判为 FAIL。
// -----------------------------------------------------------------------------
async function tk04_anonymous(linkUrl, expectTitleHint) {
  if (!linkUrl) {
    record('TK-04', '匿名访问分享链接', 'BLOCKED', 'TK-03 未产出 link_url');
    return;
  }
  try {
    const res = await fetch(linkUrl, {
      redirect: 'follow',
      headers: {
        // 模拟普通浏览器，避免被当作脚本直接挡回
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) x-share-harness',
      },
    });
    const finalUrl = res.url;
    const html = await res.text();

    // 登录/授权页启发式判断
    const looksLikeLogin =
      /\/login|\/auth|passport|signin|sign-in/i.test(finalUrl) ||
      /(请登录|立即登录|登录后查看|需要登录|scan.*qr|扫码登录)/.test(html);

    // 尝试抓 <title>
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : '(无 title)';

    const okStatus = res.status === 200;
    const titleSeen =
      pageTitle && pageTitle !== '(无 title)' &&
      (!expectTitleHint || html.includes(expectTitleHint) || pageTitle.includes(expectTitleHint));

    const detail =
      `HTTP ${res.status}\n最终URL=${finalUrl}\n页面title=${pageTitle}\n` +
      `疑似登录页=${looksLikeLogin ? '是' : '否'}\n命中期望标题=${titleSeen ? '是' : '否/未知'}`;

    if (okStatus && !looksLikeLogin) {
      record('TK-04', '匿名访问分享链接', 'PASS', detail);
    } else {
      record('TK-04', '匿名访问分享链接', 'FAIL', detail);
    }
  } catch (e) {
    record('TK-04', '匿名访问分享链接', 'FAIL', `异常：${e.message}`);
  }
}

// -----------------------------------------------------------------------------
// TK-05 前端可行性判定（纯静态，不发请求）
//   基于第一步官方文档结论：换 / 刷新 token 是否必须后端。
//   证据（原文，摘自授权页「第二步：获取令牌」的「提示」）：
//   「由于应用 appkey 和获取到的 access_token 安全级别比较高，
//     后续刷新 access_token、通过 access_token 获取用户信息等步骤，
//     必须从服务器调用接口。」
//   来源：https://developer.kdocs.cn/common/authorization/web.html
// -----------------------------------------------------------------------------
function tk05_frontendVerdict() {
  const verdict = '换 / 刷新 token 必须后端（官方明确要求「必须从服务器调用接口」）';
  const quote =
    '「由于应用 appkey 和获取到的 access_token 安全级别比较高，后续刷新 access_token、' +
    '通过 access_token 获取用户信息等步骤，必须从服务器调用接口。」';
  const src = 'https://developer.kdocs.cn/common/authorization/web.html';
  record('TK-05', '前端可行性判定（换token是否必须后端）', 'PASS',
    `结论：${verdict}\n引文：${quote}\n来源：${src}\n` +
    `含义：x-share 纯前端扩展无法安全地用 app_key 换 / 刷新 token，需一个最小后端（或 serverless）` +
    `代持 app_key 并下发 access_token / 临时凭证。`);
}

// -----------------------------------------------------------------------------
// 清理：把测试创建的文档移入回收站
// 文档：https://developer.kdocs.cn/server/personal/delete-files.html
//   DELETE /api/v1/openapi/personal/files/:file_token?access_token=...
//   返回 { code:0, data:{} }
// -----------------------------------------------------------------------------
async function cleanup(fileToken) {
  if (!fileToken) {
    console.log('\n[清理] 无测试文档可清理（TK-02 未创建成功）。');
    return;
  }
  if (!ACCESS_TOKEN) return;
  try {
    const r = await apiJson('DELETE',
      withToken(`${API}/personal/files/${encodeURIComponent(fileToken)}`));
    if (r.res.ok && r.json && r.json.code === 0) {
      console.log(`\n[清理] 已将测试文档 ${fileToken} 移入回收站。`);
    } else {
      console.log(`\n[清理] 自动删除失败 ${explainHttp(r)}`);
      console.log(`[清理] ⚠️ 请手动到金山文档回收站删除：file_token=${fileToken}`);
    }
  } catch (e) {
    console.log(`\n[清理] 删除异常：${e.message}`);
    console.log(`[清理] ⚠️ 请手动删除：file_token=${fileToken}`);
  }
}

// ---- 汇总表 ----
function printTable() {
  console.log('\n\n================= 汇总 =================');
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('用例', 8) + pad('名称', 34) + '结果');
  console.log('-'.repeat(60));
  for (const r of results) {
    const tag = r.status === 'PASS' ? 'PASS' : r.status === 'FAIL' ? 'FAIL' : 'BLOCKED';
    // 名称含中文，padEnd 按字符数近似对齐即可
    console.log(pad(r.id, 8) + pad(r.name.slice(0, 16), 34) + tag);
  }
  console.log('=======================================\n');
}

// ---- 主流程 ----
async function main() {
  console.log('金山文档（WPS 开放平台）个人版 API 验证 harness');
  console.log(`HOST=${HOST}`);
  console.log(`KDOCS_ACCESS_TOKEN=${ACCESS_TOKEN ? '(已设置)' : '(未设置 -> 联网用例将 BLOCKED)'}`);
  console.log(`KDOCS_PROBE=${PROBE_MODE}`);

  await tk01_credential();
  const { fileToken, method } = await tk02_createDoc();
  const titleHint = fileToken ? undefined : undefined; // 呈现由 TK-04 观察，不强制命中
  const { linkUrl } = await tk03_createShare(fileToken);
  await tk04_anonymous(linkUrl, titleHint);
  tk05_frontendVerdict();

  await cleanup(fileToken);
  printTable();

  // 若关键联网用例存在 FAIL，退出码非 0，方便 CI / 脚本判断
  const hasFail = results.some((r) => r.status === 'FAIL');
  process.exit(hasFail ? 1 : 0);
}

main().catch((e) => {
  console.error('harness 顶层异常：', e);
  process.exit(2);
});
