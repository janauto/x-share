// 腾讯文档「无感发布」—— 仅在 docs.qq.com 运行的内容脚本（状态机 v2）。
//
// 背景（见 scratchpad/txdocs-recon.md）：腾讯文档编辑器是 canvas 自绘富文本，
// 合成事件常被 isTrusted 过滤、选择器随改版频繁失效、且无匿名直达建档 URL。
// v2 在 v1「引导式半自动」之上叠了两级自动化，按优先级三级降级：
//
//   ① 导入路径（最优）：x.com 侧把推文构造成 .docx（emit-docx + zipdocx），存进
//      pending 的 docxB64；本脚本在 desktop 页找 input[type=file] 投递文件，让
//      腾讯文档服务端转换——排版最佳、零手动。
//   ② CDP 受信粘贴：设置页开启「腾讯文档全自动粘贴」（optional debugger 权限）后，
//      后台经 chrome.debugger 发真实 ⌘V/Ctrl+V（isTrusted=true），绕过编辑器对
//      合成事件的过滤。attach 期间顶部有「正在调试此浏览器」横幅，属预期。
//   ③ 引导式手动粘贴（兜底，v1 原样）：内容已在系统剪贴板（x.com 侧 copyRich
//      写入），用户按一次 ⌘V，其余各步「自动优先、失败退成可视化引导」。
//
// 触发方式：content.js 把 { html, plain, title, ts, docxB64? } 存进
// chrome.storage.local 键 xsTxdocsPending，然后 window.open('https://docs.qq.com/desktop')。
// 本脚本作为常驻内容脚本在 docs.qq.com 的每个页面注入，启动时读 pending：无任务 /
// 过期则静默退出；有任务则挂引导浮层，按状态机推进。pending.stage 记录导入进度
// （'import-started' / 'import-arrived' / 'paste-fallback'），供「新建/导入常在新
// 标签打开文档、由那边的新注入接手」的多标签接力用，也防重复导入。

(() => {
  'use strict';

  // ---------- 纯函数（可 node require 单测；见 test/txdocs.test.js）----------
  // 抽成纯函数是为了：链接判定/标题截断/有效期/导入 input 打分这类易错逻辑能脱离 DOM 单测。

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
  // 只看 ts——stage / docxB64 等扩展字段不参与判定（向后兼容 v1 pending）。
  function isPendingFresh(obj, now = Date.now(), maxAgeMs = 10 * 60 * 1000) {
    if (!obj || typeof obj !== 'object') return false;
    const ts = obj.ts;
    if (typeof ts !== 'number' || !isFinite(ts) || ts <= 0) return false;
    const age = now - ts;
    if (age < 0) return false;          // 时间倒流（时钟异常）当作过期
    return age <= maxAgeMs;
  }

  // 从候选 input[type=file] 里挑最像「文档导入」的那个（导入路径用）。
  // 打分：accept 提到 doc（.doc/.docx/officedocument…都含 "doc"）+2，明确到
  // docx/wordprocessingml 再 +2；accept 限定了类型却与 doc 无关（如 image/*）-2；
  // 可见性不作要求——上传入口的 input 几乎都是隐藏的。返回得分最高者（并列取
  // 先出现的），空列表返回 null。只读 .accept 字段，node 可拿普通对象单测。
  function pickImportInput(inputs) {
    if (!Array.isArray(inputs) || !inputs.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const el of inputs) {
      const accept = String((el && el.accept) || '').toLowerCase();
      let score = 1; // 基础分：是 input[type=file] 就是候选
      if (accept.includes('doc')) score += 2;
      if (accept.includes('docx') || accept.includes('wordprocessingml')) score += 2;
      if (accept && !accept.includes('doc')) score -= 2;
      if (score > bestScore) { best = el; bestScore = score; }
    }
    return best;
  }

  const PURE = { pickDocUrl, buildTitle, isPendingFresh, pickImportInput };
  // node 单测入口 + 页面调试入口；两栖导出，node 里 require 后取 module.exports。
  if (typeof module !== 'undefined' && module.exports) module.exports = PURE;
  if (typeof window !== 'undefined') window.__xsTxdocsPure = PURE;

  // node（无 document）里到此为止——只导出纯函数，不跑浮层逻辑。
  if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;
  if (window.__XS_TXDOCS_LOADED) return; // 同页避免重复挂载
  window.__XS_TXDOCS_LOADED = true;

  const XS = globalThis.__XS; // rpc / zipdocx 由 manifest 先注入（shared 段）

  // ---------- 选择器 / 文案候选（腾讯文档改版时优先改这里）----------
  // 与 extract.js 对 X 的做法呼应：把易碎的文案集中一处。findByText 会按数组顺序，
  // 先精确匹配、再包含匹配。腾讯文档界面文案随版本变化，命中失败时看「复制诊断信息」。
  const CANDIDATES = {
    新建: ['新建', '+ 新建', '＋ 新建', '新建文档'],
    在线文档: ['在线文档', '文档', '新建文档', 'Word', '智能文档'],
    导入: ['导入', '本地文件', '导入本地文件', '上传本地文件'],
    导入确认: ['确定', '导入', '上传'],
    分享: ['分享', '协作', '邀请'],
    权限入口: ['获得链接的任何人', '权限', '公开', '谁可以访问', '协作权限'],
    权限目标: ['获得链接的任何人可查看', '所有人可查看', '任何人可查看', '获得链接的人可查看', '可查看'],
  };

  const PENDING_KEY = 'xsTxdocsPending';
  const NEW_DOC_TIMEOUT = 8000;   // 粘贴路径步骤1：desktop 自动新建等待跳转上限
  const PERM_STEP_TIMEOUT = 5000; // 权限步骤：每个子步骤上限
  const IMPORT_TIMEOUT = 20000;   // 导入路径整体上限：超时降级为粘贴路径
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
  // 步骤列表按路径动态换：导入路径三步 / 粘贴路径四步（setSteps 重建）。

  let host, titleEl, stepsEl, hintEl, actionsEl;
  let stepNodes = {};   // stepKey -> { row, icon, label }
  let currentDefs = []; // 当前生效的步骤定义（setStep 取 label 用）
  const STEPS_PASTE = [
    { key: 'new', label: '新建文档' },
    { key: 'paste', label: '粘贴图文' },
    { key: 'perm', label: '设为任何人可查看' },
    { key: 'link', label: '取回链接' },
  ];
  const STEPS_IMPORT = [
    { key: 'import', label: '导入文档' },
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

    // 步骤列表（内容由 setSteps 按当前路径填充）
    stepsEl = document.createElement('div');
    css(stepsEl, 'padding:10px 14px 6px');
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

  // 重建步骤列表（导入路径 ↔ 粘贴路径切换时调用；已完成标记不保留，由调用方重设）
  function setSteps(defs) {
    currentDefs = defs;
    stepNodes = {};
    if (!stepsEl) return;
    stepsEl.textContent = '';
    defs.forEach((s) => {
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
  }

  // step 图标：✓ 成功 / ⏳ 进行中 / ✋ 需手动 / ○ 未开始。key 不在当前路径时静默忽略。
  function setStep(key, mark, note) {
    const n = stepNodes[key];
    if (!n) return;
    const glyph = { done: '✓', doing: '⏳', manual: '✋', idle: '○' }[mark] || '○';
    n.icon.textContent = glyph;
    const color = { done: '#00ba7c', doing: '#1d9bf0', manual: '#f5a623', idle: '#8b98a5' }[mark] || '#8b98a5';
    n.row.style.color = color;
    const def = currentDefs.find((s) => s.key === key);
    n.label.textContent = (def ? def.label : key) + (note ? ` — ${note}` : '');
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

  // ---------- pending 读写（多标签接力靠 stage 字段）----------

  let task = null; // { html, plain, title, ts, docxB64?, stage? }

  async function readPending() {
    try {
      const store = await chrome.storage.local.get(PENDING_KEY);
      return (store && store[PENDING_KEY]) || null;
    } catch (_) { return null; }
  }

  // 更新 stage 并回写整个 task（含 docxB64，可能几 MB——只写 2~3 次，可接受）。
  async function setStage(stage) {
    if (!task) return;
    task.stage = stage;
    try { await chrome.storage.local.set({ [PENDING_KEY]: task }); } catch (_) {}
    log('stage → ' + stage);
  }

  // ---------- 状态机主流程 ----------
  //
  // 路由（main）：
  //   文档页 + stage=import-*        → 导入接力：标记已导入，直进权限步骤
  //   文档页（其余）                  → 粘贴路径从步骤2（粘贴）起
  //   非文档页 + docxB64 + 无 stage  → 导入路径（stepImport，20s 内没走通降级粘贴）
  //   非文档页 + stage=import-*      → 已导入过：不重复投递，给「改走粘贴」入口
  //   非文档页（其余）                → 粘贴路径从步骤1（新建）起

  async function main() {
    const pending = await readPending();

    if (!isPendingFresh(pending)) {
      // 无任务 / 过期：静默退出，顺手清理过期键（畸形/过期都清）
      if (pending) { try { await chrome.storage.local.remove(PENDING_KEY); } catch (_) {} }
      return;
    }
    task = pending;

    buildOverlay(task.title);
    const stage = typeof task.stage === 'string' ? task.stage : '';
    log(`启动 URL 形态=${urlShape(location.href)} docx=${task.docxB64 ? '有' : '无'} stage=${stage || '(初始)'}`);

    const docUrl = pickDocUrl(location.href);
    if (docUrl) {
      if (task.docxB64 && stage.startsWith('import')) {
        // 导入产生的文档页（常在新标签打开，由这份新注入接手）：导入已成，直进权限
        log('入口=文档页（导入接力），跳过粘贴直接设权限');
        setSteps(STEPS_IMPORT);
        setStep('import', 'done', '已自动导入');
        await setStage('import-arrived'); // 告知 desktop 侧「别降级了」
        setHint('文档已自动导入 ✓ 正在设置权限…');
        await sleep(1000); // 转换后的编辑页仍在初始化，给分享按钮一点渲染时间
        await stepPerm();
      } else {
        // 已经在文档编辑页（desktop 新建常在新标签打开文档，这份注入直接从步骤2 起）
        log('入口=文档页，直接进粘贴步骤');
        setSteps(STEPS_PASTE);
        setStep('new', 'done', '已在文档页');
        await stepPaste();
      }
    } else if (task.docxB64 && !stage) {
      // 在 desktop / 其它页且带 docx：优先导入路径
      log('入口=非文档页，pending 带 docx，走导入路径');
      setSteps(STEPS_IMPORT);
      await stepImport();
    } else if (task.docxB64 && stage.startsWith('import')) {
      // desktop 页重复注入（刷新/回跳）：不重复投递，避免生成重复文档
      log('入口=非文档页，已尝试过导入（stage=' + stage + '），不重复投递');
      setSteps(STEPS_IMPORT);
      setStep('import', 'manual');
      setHint('已尝试过自动导入。若文档已在新标签打开，请到那个标签继续；否则可改走粘贴流程。');
      setActions([
        { text: '改走粘贴流程', primary: true, onClick: () => { downgradeToPaste(); } },
        { text: '关闭', onClick: () => finish(true) },
      ]);
    } else {
      // 在 desktop / 其它页：粘贴路径，从新建开始
      log('入口=非文档页，从新建开始（粘贴路径）');
      setSteps(STEPS_PASTE);
      await stepNewDoc();
    }
  }

  // 步骤0（导入路径）：把 docx 投给页面的 input[type=file]，让腾讯文档服务端转换。
  // 整体 20s 上限；本页跳转→直进权限，新标签打开→那边接力，都没有→降级粘贴路径。
  let importStarted = false;
  async function stepImport() {
    if (importStarted) return;
    importStarted = true;
    setStep('import', 'doing');
    setHint('正在自动导入文档（服务端转换，排版最佳）…');
    setActions([]);
    const t0 = Date.now();
    const deadline = t0 + IMPORT_TIMEOUT;

    await setStage('import-started'); // 先落 stage：新标签注入据此接力、防重复导入

    // 找 input[type=file]（含隐藏的；accept 含 doc 优先）；没有就点「导入」后等它出现
    const allInputs = () => [...document.querySelectorAll('input[type="file"]')];
    let input = pickImportInput(allInputs());
    let importBtn = null;
    if (input) {
      log('步骤0 页面已有 input[type=file]，直接投递（accept=' + (input.accept || '空') + '）');
    } else {
      importBtn = findByText(CANDIDATES.导入);
      if (importBtn) {
        log('步骤0 点「导入」，文案=' + (importBtn.textContent || '').trim().slice(0, 12));
        importBtn.click();
        input = await waitFor(() => pickImportInput(allInputs()), { timeout: 6000 });
        log(input ? '步骤0 导入后出现 input[type=file]（accept=' + (input.accept || '空') + '）' : '步骤0 点导入后未等到 input[type=file]');
      } else {
        log('步骤0 未找到导入入口按钮');
      }
    }

    if (input) {
      try {
        const bytes = XS.zipdocx.dataUrlToBytes('data:' + DOCX_MIME + ';base64,' + task.docxB64).bytes;
        const file = new File([bytes], 'x-share-推文.docx', { type: DOCX_MIME });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        log(`步骤0 已投递 docx（${Math.round(bytes.length / 1024)} KB）`);
      } catch (e) {
        log('步骤0 投递 docx 抛错：' + ((e && e.message) || e));
        input = null; // 走降级
      }
    }

    if (input) {
      // 可能出现确认弹窗（不同版本文案不一）；排除刚点过的导入按钮自身，防止误点重开菜单
      const confirmBtn = await waitFor(() => {
        const el = findByText(CANDIDATES.导入确认);
        return el && el !== importBtn ? el : null;
      }, { timeout: 4000 });
      if (confirmBtn) {
        log('步骤0 点确认弹窗，文案=' + (confirmBtn.textContent || '').trim().slice(0, 8));
        confirmBtn.click();
      } else {
        log('步骤0 未见确认弹窗（可能直接开始上传）');
      }

      // 等本页跳到文档页；若在新标签打开，那边的新注入按 stage=import-started 接力
      setHint('文档上传转换中…（若在新标签打开，去那个标签即可，向导会自动接手）');
      const arrived = await waitFor(() => pickDocUrl(location.href), {
        timeout: Math.max(1000, deadline - Date.now()), interval: 500,
      });
      if (arrived && !finished) {
        log(`步骤0 导入成功（本页跳转），耗时 ${Date.now() - t0}ms`);
        setStep('import', 'done', '已自动导入');
        await setStage('import-arrived');
        setHint('文档已自动导入 ✓ 正在设置权限…');
        await sleep(1000);
        await stepPerm();
        return;
      }
    }
    if (finished) return;

    // 新标签可能已接力：pending 变成 import-arrived / 被清除时，本页收工别再折腾
    const cur = await readPending();
    if (!cur || (cur.stage && cur.stage === 'import-arrived')) {
      log('步骤0 新标签已接手（' + (cur ? 'stage=import-arrived' : 'pending 已清除') + '），本页收工');
      setStep('import', 'done', '已在新标签接手');
      setHint('文档已在新标签打开，请到那个标签继续（本卡片可关闭）。');
      setActions([{ text: '关闭', primary: true, onClick: () => finish(false) }]);
      return;
    }

    log(`步骤0 导入 ${Math.round((Date.now() - t0) / 1000)}s 内未走通，降级为粘贴路径`);
    await downgradeToPaste();
  }

  // 导入失败 → 粘贴路径：换回四步列表，stage 标记 fallback
  // （之后新建的文档页在新标签打开时，那边按粘贴流接手，不会误判成导入成功）。
  async function downgradeToPaste() {
    await setStage('paste-fallback');
    setSteps(STEPS_PASTE);
    setHint('自动导入未走通，改走粘贴流程…');
    await stepNewDoc();
  }

  // 步骤1（粘贴路径）：新建文档
  let newDocStarted = false;
  async function stepNewDoc() {
    if (newDocStarted) return;
    newDocStarted = true;
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

  // 步骤2（粘贴路径）：粘贴图文。二级降级：
  //   ②CDP 受信粘贴（真实 ⌘V，需 debugger 权限）→ ③合成 paste + 手动 ⌘V 引导。
  let pasteStarted = false;
  async function stepPaste() {
    if (pasteStarted) return; // 防止「已在文档页」与「延迟跳转」两路重入
    pasteStarted = true;
    setStep('paste', 'doing');
    setHint('图文已在剪贴板。正在尝试自动注入…');
    setActions([]);

    const editor = await waitFor(() => findEditor(), { timeout: 6000 });
    const readLen = () => ((findEditor() || document.body).textContent || '').length;
    const baseLen = editor ? (editor.textContent || '').length : (document.body.textContent || '').length;

    // 通道②：CDP 受信粘贴（后台经 chrome.debugger 发真实按键，isTrusted=true）
    const trusted = await tryTrustedPaste(editor, baseLen, readLen);
    if (trusted && !finished && !permStarted) {
      setStep('paste', 'done', '已自动粘贴');
      setHint('已自动粘贴 ✓ 正在设置权限…');
      goPerm();
      return;
    }
    if (finished || permStarted) return;

    // 通道③：合成 paste 尝试（canvas 编辑器常过滤 isTrusted，成败都不阻断）
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

    // 无论合成成败，一律提示手动 ⌘V（兜底主通道）
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
    setStep('paste', 'manual');
    setHint(`请手动粘贴：点一下正文区域，按 ${isMac ? '⌘V' : 'Ctrl+V'}（图文已在剪贴板）。粘好后会自动进入下一步。`);
    setActions([
      { text: '已粘贴，下一步', primary: true, onClick: () => { log('步骤2 手动确认粘贴'); goPerm(); } },
    ]);

    // 轮询检测：编辑器/页面文本量显著增加即认为粘贴完成
    const grown = await waitFor(() => readLen() > baseLen + 20, { timeout: 120000, interval: 700 });

    if (grown && !finished && !permStarted) {
      log(`步骤2 检测到内容增加（合成尝试=${synthTried}），自动进权限步骤`);
      setStep('paste', 'done', '内容已注入');
      goPerm();
    }
  }

  // CDP 受信粘贴：查权限 → 调用前一刻重写剪贴板（防用户中途复制别的）→ 聚焦编辑器 →
  // 让后台对本 tab 发真实 ⌘V → 用内容增长检测确认生效。任何一步不成返回 false（不抛）。
  // 注意：attach 期间顶部会短暂出现「正在调试此浏览器」横幅（~秒级），属预期。
  async function tryTrustedPaste(editor, baseLen, readLen) {
    if (!XS || !XS.rpc || !XS.rpc.canTrustedPaste) { log('步骤2 rpc 未注入，跳过受信粘贴'); return false; }
    let can = null;
    try { can = await XS.rpc.canTrustedPaste(); } catch (_) { can = null; }
    if (!can || !can.ok || !can.granted) {
      log('步骤2 受信粘贴不可用（未在设置页开启「腾讯文档全自动粘贴」）');
      return false;
    }
    log('步骤2 debugger 已授权，尝试 CDP 受信粘贴');
    setHint('正在自动粘贴（顶部可能短暂出现调试提示条，属正常）…');

    // 受信按键粘贴的是「当下」系统剪贴板：调用前一刻 best-effort 重写，
    // 失败不阻断（x.com 侧点按钮时已写过一次）。
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([task.html], { type: 'text/html' }),
        'text/plain': new Blob([task.plain || ''], { type: 'text/plain' }),
      })]);
      log('步骤2 调用前已重写剪贴板');
    } catch (_) {
      log('步骤2 重写剪贴板失败（沿用 x.com 侧写入的内容）');
    }

    // CDP 按键落在页面焦点元素上：先聚焦编辑器，否则会粘空/粘错处
    try { if (editor) { editor.focus(); if (editor.click) editor.click(); } } catch (_) {}

    let r = null;
    try { r = await XS.rpc.trustedPaste(); } catch (_) { r = null; }
    if (!r || !r.ok) {
      // NO_PERMISSION 可重试（个别 Chrome 版本授权后要等 SW 重启）；attach 冲突
      //（已开 DevTools）等一律降级到合成+手动，不阻塞流程。
      log('步骤2 受信粘贴失败：' + ((r && r.error) || '未知') + '，降级');
      return false;
    }
    // 后台固定等待 150ms 对大图文可能偏短：这里再用内容增长检测校验是否真粘进去了
    const grown = await waitFor(() => readLen() > baseLen + 20, { timeout: 8000, interval: 400 });
    log('步骤2 受信粘贴' + (grown ? '生效（内容已增长）' : '未检测到内容增长，降级'));
    return !!grown;
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
    setStep('paste', 'done'); // 粘贴路径专属，导入路径无此步（setStep 对缺失 key 静默）
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
