// 腾讯文档「引导式半自动」发布 —— 仅在 docs.qq.com 运行的内容脚本。
//
// 背景（见 scratchpad/txdocs-recon.md）：腾讯文档编辑器是 canvas 自绘富文本，
// 合成事件常被 isTrusted 过滤、选择器随改版频繁失效、且无匿名直达建档 URL。
// 因此 v1 走「引导式半自动」：内容通过系统剪贴板（用户在 content.js 弹窗里点击时
// 已用 copyRich 写入）传输，用户到编辑器按一次 ⌘V 即注入；其余各步「自动优先、
// 失败退成可视化引导」，最坏情况是带向导的手动流。首跑即校准选择器。
//
// 为什么不做全自动后台导入：真正的零手动需要腾讯文档 OpenAPI + 自建后端换 access_token
// （README 路线图里已列该条目）；而本脚本会话内合成的 paste 事件会被编辑器 isTrusted 过滤，
// 无法可靠注入。这属于平台约束（canvas 编辑器 + 无匿名建档 API），不是本插件的缺陷。
//
// 触发方式：content.js 把 { html, plain, title, ts } 存进 chrome.storage.local
// 键 xsTxdocsPending，然后 window.open('https://docs.qq.com/desktop')。本脚本
// 作为常驻内容脚本在 docs.qq.com 的每个页面注入，启动时读 pending：无任务 / 过期
// 则静默退出；有任务则挂引导浮层，按状态机推进。

(() => {
  'use strict';

  // ---------- 纯函数（可 node require 单测；见 scratchpad/verify-txdocs.js）----------
  // 抽成纯函数是为了：链接判定/标题截断/有效期这类易错逻辑能脱离 DOM 单测。

  // 判定并规范化「文档编辑页」链接：是文档页返回去掉 query 的干净 URL，否则返回 null。
  // 腾讯文档编辑页路径形态多样：/doc/<id>、/pad/<id>、/sheet/<id>、/slide/<id>、/form/<id>。
  // desktop / login / 其它域一律不算文档页。
  function pickDocUrl(href) {
    if (typeof href !== 'string' || !href) return null;
    let u;
    try { u = new URL(href); } catch (_) { return null; }
    if (!/(^|\.)docs\.qq\.com$/.test(u.hostname)) return null;
    // 文档编辑页：第一段是 doc/pad/sheet/slide/form，且其后紧跟非空的文档 id
    if (!/^\/(doc|pad|sheet|slide|form)\/[^/]+/.test(u.pathname)) return null;
    return u.origin + u.pathname; // 去掉 query / hash，得到干净分享链接
  }

  // 生成浮层标题：作者名 + 摘要，截断到 ~max 字。空值安全。
  // 实现已收敛到 shared/fmt.js（唯一一份）：node 里 require 兄弟模块，
  // docs.qq.com 页面里由 manifest 先注入 shared/fmt.js、从 globalThis.__XS 取。
  // 此处保留同名导出以兼容既有 node 单测约定（module.exports.buildTitle）。
  const buildTitle = (typeof module !== 'undefined' && module.exports)
    ? require('../shared/fmt.js').buildTitle
    : globalThis.__XS.buildTitle;

  // 任务是否仍新鲜（10 分钟有效期）。畸形对象一律判为不新鲜（触发清理）。
  function isPendingFresh(obj, now = Date.now(), maxAgeMs = 10 * 60 * 1000) {
    if (!obj || typeof obj !== 'object') return false;
    const ts = obj.ts;
    if (typeof ts !== 'number' || !isFinite(ts) || ts <= 0) return false;
    const age = now - ts;
    if (age < 0) return false;          // 时间倒流（时钟异常）当作过期
    return age <= maxAgeMs;
  }

  const PURE = { pickDocUrl, buildTitle, isPendingFresh };
  // node 单测入口 + 页面调试入口；两栖导出，node 里 require 后取 module.exports。
  if (typeof module !== 'undefined' && module.exports) module.exports = PURE;
  if (typeof window !== 'undefined') window.__xsTxdocsPure = PURE;

  // node（无 document）里到此为止——只导出纯函数，不跑浮层逻辑。
  if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;
  if (window.__XS_TXDOCS_LOADED) return; // 同页避免重复挂载
  window.__XS_TXDOCS_LOADED = true;

  // ---------- 选择器 / 文案候选（腾讯文档改版时优先改这里）----------
  // 与 extract.js 对 X 的做法呼应：把易碎的文案集中一处。findByText 会按数组顺序，
  // 先精确匹配、再包含匹配。腾讯文档界面文案随版本变化，命中失败时看「复制诊断信息」。
  const CANDIDATES = {
    新建: ['新建', '+ 新建', '＋ 新建', '新建文档'],
    在线文档: ['在线文档', '文档', '新建文档', 'Word', '智能文档'],
    分享: ['分享', '协作', '邀请'],
    权限入口: ['获得链接的任何人', '权限', '公开', '谁可以访问', '协作权限'],
    权限目标: ['获得链接的任何人可查看', '所有人可查看', '任何人可查看', '获得链接的人可查看', '可查看'],
  };

  const PENDING_KEY = 'xsTxdocsPending';
  const NEW_DOC_TIMEOUT = 8000;  // 步骤1：desktop 自动新建等待跳转上限
  const PERM_STEP_TIMEOUT = 5000; // 步骤3：每个权限子步骤上限

  // ---------- DOM/时序小工具 ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 元素是否可见（排除 display:none / 尺寸为 0 / offsetParent 为空）。
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // 按文案在可点元素里找一个：限定 button / [role=button] / [role=menuitem] / a 等，
  // 文案精确匹配优先、包含匹配兜底，排除隐藏元素。返回命中元素或 null。
  function findByText(texts) {
    const list = Array.isArray(texts) ? texts : [texts];
    const sel = 'button,[role="button"],[role="menuitem"],[role="menuitemradio"],a,[class*="btn"],[class*="button"],[class*="menu-item"],li,span,div';
    const nodes = [...document.querySelectorAll(sel)].filter(isVisible);
    // 先整轮精确匹配（trim 后完全相等），避免「文档」误命中含「文档」的长文案
    for (const want of list) {
      const hit = nodes.find((n) => (n.textContent || '').trim() === want);
      if (hit) return hit;
    }
    // 再包含匹配：取「文本最短」的命中，尽量落到叶子可点节点而非大容器
    let best = null, bestLen = Infinity;
    for (const n of nodes) {
      const txt = (n.textContent || '').trim();
      if (!txt || txt.length > 40) continue; // 过长多半是容器，跳过
      if (list.some((w) => txt.includes(w)) && txt.length < bestLen) { best = n; bestLen = txt.length; }
    }
    return best;
  }

  // 轮询等待 predicate 为真值；超时返回 null（不抛，交给调用方转手动引导）。
  async function waitFor(predicate, { timeout = 8000, interval = 300 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      let v = null;
      try { v = predicate(); } catch (_) { v = null; }
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  // ---------- 诊断日志（不含文档内容，仅记自动化成败/耗时/URL 形态/命中文案）----------
  const diag = [];
  function log(line) {
    diag.push(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
  }
  function urlShape(href) {
    // 只留结构，不泄露文档 id：/doc/xxxx → /doc/<id>
    try {
      const u = new URL(href);
      const path = u.pathname.replace(/\/(doc|pad|sheet|slide|form)\/[^/]+/, '/$1/<id>');
      return u.hostname + path + (u.search ? '?<query>' : '');
    } catch (_) { return '(无法解析)'; }
  }

  // ---------- 浮层（全部 createElement + 内联样式，不注入 <style>，CSP 未知）----------
  // 参照 card.js 的 cssText 做法：CSSOM 赋值不受 style-src CSP 拦截。

  let host, titleEl, stepsEl, hintEl, actionsEl;
  const stepNodes = {}; // stepKey -> { row, icon, label }
  const STEP_DEFS = [
    { key: 'new', label: '新建文档' },
    { key: 'paste', label: '粘贴图文' },
    { key: 'perm', label: '设为任何人可查看' },
    { key: 'link', label: '取回链接' },
  ];

  function css(el, text) { el.style.cssText = text; }

  function buildOverlay(taskTitle) {
    host = document.createElement('div');
    css(host,
      'position:fixed;right:20px;bottom:20px;z-index:2147483647;width:320px;max-width:calc(100vw - 40px);' +
      'background:#fff;color:#0f1419;border:1px solid #cfd9de;border-radius:14px;' +
      'box-shadow:0 8px 30px rgba(0,0,0,.18);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;' +
      'font-size:13px;line-height:1.5;overflow:hidden');

    // 头部：标题 + 关闭
    const head = document.createElement('div');
    css(head, 'display:flex;align-items:center;gap:8px;padding:12px 14px;background:#f7f9f9;border-bottom:1px solid #eff3f4');
    const brand = document.createElement('span');
    css(brand, 'font-weight:700;font-size:13px;flex:none');
    brand.textContent = '𝕏 → 腾讯文档';
    titleEl = document.createElement('span');
    css(titleEl, 'flex:1;min-width:0;color:#536471;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
    titleEl.textContent = taskTitle || '';
    titleEl.title = taskTitle || '';
    const closeBtn = document.createElement('button');
    css(closeBtn, 'flex:none;border:none;background:transparent;color:#536471;font-size:16px;line-height:1;cursor:pointer;padding:2px 4px');
    closeBtn.textContent = '×';
    closeBtn.title = '关闭并结束本次发布';
    closeBtn.addEventListener('click', () => finish(true));
    head.appendChild(brand);
    head.appendChild(titleEl);
    head.appendChild(closeBtn);
    host.appendChild(head);

    // 步骤列表
    stepsEl = document.createElement('div');
    css(stepsEl, 'padding:10px 14px 6px');
    STEP_DEFS.forEach((s) => {
      const row = document.createElement('div');
      css(row, 'display:flex;align-items:flex-start;gap:8px;padding:3px 0;color:#8b98a5');
      const icon = document.createElement('span');
      css(icon, 'flex:none;width:16px;text-align:center');
      icon.textContent = '○';
      const label = document.createElement('span');
      css(label, 'flex:1');
      label.textContent = s.label;
      row.appendChild(icon);
      row.appendChild(label);
      stepsEl.appendChild(row);
      stepNodes[s.key] = { row, icon, label };
    });
    host.appendChild(stepsEl);

    // 提示区
    hintEl = document.createElement('div');
    css(hintEl, 'padding:8px 14px;background:#f5f8fa;border-top:1px solid #eff3f4;color:#0f1419;min-height:20px;word-break:break-word');
    host.appendChild(hintEl);

    // 操作按钮区
    actionsEl = document.createElement('div');
    css(actionsEl, 'display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px;border-top:1px solid #eff3f4');
    host.appendChild(actionsEl);

    // 底部：诊断 / 说明
    const foot = document.createElement('div');
    css(foot, 'display:flex;gap:12px;padding:8px 14px;border-top:1px solid #eff3f4;background:#f7f9f9');
    const diagBtn = document.createElement('a');
    css(diagBtn, 'color:#536471;font-size:12px;cursor:pointer;text-decoration:underline');
    diagBtn.textContent = '复制诊断信息';
    diagBtn.title = '复制自动化各步成败/耗时/URL 形态（不含文档内容），发回来可校准选择器';
    diagBtn.addEventListener('click', copyDiag);
    foot.appendChild(diagBtn);
    host.appendChild(foot);

    document.body.appendChild(host);
  }

  // step 图标：✓ 成功 / ⏳ 进行中 / ✋ 需手动 / ○ 未开始
  function setStep(key, mark, note) {
    const n = stepNodes[key];
    if (!n) return;
    const glyph = { done: '✓', doing: '⏳', manual: '✋', idle: '○' }[mark] || '○';
    n.icon.textContent = glyph;
    const color = { done: '#00ba7c', doing: '#1d9bf0', manual: '#f5a623', idle: '#8b98a5' }[mark] || '#8b98a5';
    n.row.style.color = color;
    n.label.textContent = STEP_DEFS.find((s) => s.key === key).label + (note ? ` — ${note}` : '');
  }

  function setHint(text) { if (hintEl) hintEl.textContent = text; }

  // 重建按钮区：defs = [{ text, primary, onClick }]
  function setActions(defs) {
    if (!actionsEl) return;
    actionsEl.textContent = '';
    (defs || []).forEach((d) => {
      const b = document.createElement('button');
      css(b,
        'flex:1;min-width:96px;border-radius:8px;padding:8px 10px;font-size:13px;font-weight:700;cursor:pointer;border:1px solid ' +
        (d.primary ? '#1d9bf0;background:#1d9bf0;color:#fff' : '#cfd9de;background:#fff;color:#0f1419'));
      b.textContent = d.text;
      b.addEventListener('click', d.onClick);
      actionsEl.appendChild(b);
    });
  }

  async function copyDiag() {
    const text = ['x-share 腾讯文档诊断（不含文档内容）', 'UA: ' + navigator.userAgent, 'URL: ' + urlShape(location.href), '---', ...diag].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setHint('诊断信息已复制 ✓ 粘回来给我们即可校准选择器');
    } catch (_) {
      setHint('复制失败，请手动选中下面文本：\n' + text.slice(0, 400));
    }
  }

  // ---------- 收尾 ----------
  let finished = false;
  function finish(clearPending) {
    if (finished) return;
    finished = true;
    if (clearPending) { try { chrome.storage.local.remove(PENDING_KEY); } catch (_) {} }
    if (host) { host.remove(); host = null; }
  }

  // ---------- 状态机主流程 ----------

  let task = null; // { html, plain, title, ts }

  async function main() {
    let store;
    try { store = await chrome.storage.local.get(PENDING_KEY); } catch (_) { return; }
    const pending = store && store[PENDING_KEY];

    if (!isPendingFresh(pending)) {
      // 无任务 / 过期：静默退出，顺手清理过期键（畸形/过期都清）
      if (pending) { try { await chrome.storage.local.remove(PENDING_KEY); } catch (_) {} }
      return;
    }
    task = pending;

    buildOverlay(task.title);
    log('启动 URL 形态=' + urlShape(location.href));

    const docUrl = pickDocUrl(location.href);
    if (docUrl) {
      // 已经在文档编辑页（desktop 新建常在新标签打开文档，这份注入直接从步骤2 起）
      log('入口=文档页，直接进粘贴步骤');
      setStep('new', 'done', '已在文档页');
      await stepPaste();
    } else {
      // 在 desktop / 其它页：先走新建
      log('入口=非文档页，从新建开始');
      await stepNewDoc();
    }
  }

  // 步骤1：新建文档
  async function stepNewDoc() {
    setStep('new', 'doing');
    setHint('正在尝试自动新建在线文档…');
    setActions([]);
    const t0 = Date.now();

    // 自动：点「新建」→「在线文档」
    const newBtn = findByText(CANDIDATES.新建);
    if (newBtn) {
      log('步骤1 找到「新建」按钮，文案=' + (newBtn.textContent || '').trim().slice(0, 12));
      newBtn.click();
      const docItem = await waitFor(() => findByText(CANDIDATES.在线文档), { timeout: 2500 });
      if (docItem) {
        log('步骤1 找到「在线文档」项，文案=' + (docItem.textContent || '').trim().slice(0, 12));
        docItem.click();
      } else {
        log('步骤1 未找到「在线文档」菜单项');
      }
    } else {
      log('步骤1 未找到「新建」按钮');
    }

    // 无论自动点击成败，都等待「本页 URL 变成文档页」——但 desktop 新建常在新标签打开，
    // 那边会由新注入的 txdocs.js 以「入口=文档页」接手，所以这里超时不算失败，转手动引导即可。
    const arrived = await waitFor(() => pickDocUrl(location.href), { timeout: NEW_DOC_TIMEOUT - 2500 });
    if (arrived) {
      log(`步骤1 自动成功，耗时 ${Date.now() - t0}ms，URL=${urlShape(location.href)}`);
      setStep('new', 'done', '自动新建成功');
      await stepPaste();
      return;
    }

    // 转手动引导
    log(`步骤1 自动未跳转（${Date.now() - t0}ms），转手动引导`);
    setStep('new', 'manual');
    setHint('请点左上角「新建」→「在线文档」。新建后本卡片会自动继续（若在新标签打开，去那个标签操作即可）。');
    setActions([
      { text: '我已新建，继续', primary: true, onClick: async () => { if (pickDocUrl(location.href)) { setStep('new', 'done', '手动确认'); await stepPaste(); } else { setHint('当前还不是文档编辑页——如在新标签打开了文档，请到那个标签操作（那边会自动接手）。'); } } },
    ]);
    // 后台继续轮询：万一同标签延迟跳转，也能自动接上
    const late = await waitFor(() => pickDocUrl(location.href), { timeout: 60000, interval: 600 });
    if (late && !finished) { log('步骤1 延迟跳转，自动接上'); setStep('new', 'done', '已进入文档'); await stepPaste(); }
  }

  // 步骤2：粘贴图文
  let pasteStarted = false;
  async function stepPaste() {
    if (pasteStarted) return; // 防止「已在文档页」与「延迟跳转」两路重入
    pasteStarted = true;
    setStep('paste', 'doing');
    setHint('图文已在剪贴板。正在尝试自动注入…');
    setActions([]);

    const editor = await waitFor(() => findEditor(), { timeout: 6000 });
    const baseLen = editor ? (editor.textContent || '').length : (document.body.textContent || '').length;

    // 自动尝试：合成 paste 事件（canvas 编辑器常过滤 isTrusted，成败都不阻断）
    let synthTried = false;
    if (editor && task.html) {
      try {
        editor.focus();
        if (editor.click) editor.click();
        const dt = new DataTransfer();
        dt.setData('text/html', task.html);
        dt.setData('text/plain', task.plain || '');
        editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
        synthTried = true;
        log('步骤2 已尝试合成 paste 注入');
      } catch (e) {
        log('步骤2 合成 paste 抛错：' + ((e && e.message) || e));
      }
    } else {
      log('步骤2 未找到编辑器区域（' + (editor ? '有编辑器' : '无编辑器') + '），仅走手动粘贴');
    }

    // 无论合成成败，一律提示手动 ⌘V（主通道）
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
    setStep('paste', 'manual');
    setHint(`请点一下正文区域，然后按 ${isMac ? '⌘V' : 'Ctrl+V'} 粘贴图文（内容已在剪贴板）。粘好后会自动进入下一步。`);
    setActions([
      { text: '已粘贴，下一步', primary: true, onClick: () => { log('步骤2 手动确认粘贴'); goPerm(); } },
    ]);

    // 轮询检测：编辑器/页面文本量显著增加即认为粘贴完成
    const grown = await waitFor(() => {
      const el = findEditor() || document.body;
      const len = (el.textContent || '').length;
      return len > baseLen + 20; // 阈值宽松：多出 20+ 字符视为已注入内容
    }, { timeout: 120000, interval: 700 });

    if (grown && !finished && !permStarted) {
      log(`步骤2 检测到内容增加（合成尝试=${synthTried}），自动进权限步骤`);
      setStep('paste', 'done', '内容已注入');
      goPerm();
    }
  }

  // 找编辑器可编辑根节点（腾讯文档多为 canvas + 隐藏 contenteditable 输入代理）
  function findEditor() {
    return document.querySelector('[contenteditable="true"]') ||
           document.querySelector('.canvas-container, [class*="editor-canvas"], [class*="melo-"], [class*="editor"]') ||
           null;
  }

  // 步骤3：设为任何人可查看
  let permStarted = false;
  function goPerm() { if (!permStarted) stepPerm(); }
  async function stepPerm() {
    if (permStarted) return;
    permStarted = true;
    setStep('paste', 'done');
    setStep('perm', 'doing');
    setHint('正在尝试自动把权限设为「获得链接的任何人可查看」…');
    setActions([]);
    const t0 = Date.now();

    let autoOk = true;
    // 子步骤 a：点分享
    const shareBtn = await waitFor(() => findByText(CANDIDATES.分享), { timeout: PERM_STEP_TIMEOUT });
    if (shareBtn) { log('步骤3 点分享，文案=' + (shareBtn.textContent || '').trim().slice(0, 8)); shareBtn.click(); }
    else { autoOk = false; log('步骤3 未找到分享入口'); }

    // 子步骤 b：进权限入口（有些版本分享面板直接就有权限选项，找不到入口不致命）
    if (autoOk) {
      const entry = await waitFor(() => findByText(CANDIDATES.权限入口), { timeout: PERM_STEP_TIMEOUT });
      if (entry) { log('步骤3 点权限入口，文案=' + (entry.textContent || '').trim().slice(0, 12)); entry.click(); }
      else log('步骤3 未找到独立权限入口（可能已在面板内）');
    }

    // 子步骤 c：选「任何人可查看」
    if (autoOk) {
      const target = await waitFor(() => findByText(CANDIDATES.权限目标), { timeout: PERM_STEP_TIMEOUT });
      if (target) { log('步骤3 选权限目标，文案=' + (target.textContent || '').trim().slice(0, 16)); target.click(); }
      else { autoOk = false; log('步骤3 未找到「任何人可查看」选项'); }
    }

    if (autoOk) {
      log(`步骤3 自动完成，耗时 ${Date.now() - t0}ms`);
      setStep('perm', 'done', '自动设置成功');
      await sleep(600); // 等权限 XHR 落库
      await stepLink();
      return;
    }

    // 转手动引导
    log(`步骤3 自动失败（${Date.now() - t0}ms），转手动引导`);
    setStep('perm', 'manual');
    setHint('请点右上角「分享」，把权限改为「获得链接的任何人可查看」。改好后点下面按钮。');
    setActions([
      { text: '已设好，完成', primary: true, onClick: () => { log('步骤3 手动确认权限'); setStep('perm', 'done', '手动确认'); stepLink(); } },
    ]);
  }

  // 步骤4：取回链接
  let linkStarted = false;
  async function stepLink() {
    if (linkStarted) return;
    linkStarted = true;
    setStep('link', 'doing');
    setHint('正在取回文档链接…');

    // 优先读分享面板里 readonly input 的 docs.qq.com 链接
    let link = readShareInput();
    if (link) log('步骤4 从分享面板输入框取到链接');
    if (!link) { link = pickDocUrl(location.href); if (link) log('步骤4 回退用当前页 URL 作链接'); }

    if (!link) {
      log('步骤4 未取到链接');
      setStep('link', 'manual');
      setHint('没自动取到链接。请在分享面板点「复制链接」，或直接复制浏览器地址栏的文档 URL 发到微信。');
      setActions([{ text: '关闭', primary: true, onClick: () => finish(true) }]);
      return;
    }

    let copied = false;
    try { await navigator.clipboard.writeText(link); copied = true; } catch (_) {}
    log('步骤4 完成，链接已' + (copied ? '复制' : '取到（复制失败）'));
    setStep('link', 'done', copied ? '链接已复制' : '已取到链接');
    setHint((copied ? '链接已复制 ✓ 发到微信即可：\n' : '请手动复制这个链接发微信：\n') + link);
    setActions([
      { text: '复制链接', onClick: async () => { try { await navigator.clipboard.writeText(link); setHint('已复制 ✓\n' + link); } catch (_) { setHint('复制失败，请手动选中：\n' + link); } } },
      { text: '完成', primary: true, onClick: () => finish(true) },
    ]);
    // 取到链接即视为收官，清理 pending（浮层留着让用户复制，关闭按钮再删 host）
    try { await chrome.storage.local.remove(PENDING_KEY); } catch (_) {}
  }

  // 从分享面板的只读输入框读 docs.qq.com 链接
  function readShareInput() {
    const inputs = [...document.querySelectorAll('input[readonly], input[type="text"], textarea')].filter(isVisible);
    for (const el of inputs) {
      const v = (el.value || '').trim();
      if (/^https?:\/\/docs\.qq\.com\//.test(v)) return pickDocUrl(v) || v;
    }
    return null;
  }

  // 启动（document_idle 注入，直接跑；出错也不抛出污染页面）
  main().catch((e) => { log('主流程异常：' + ((e && e.message) || e)); });
})();
