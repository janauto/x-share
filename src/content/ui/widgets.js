// 页面内 UI 组件（视图层）——「无痕 Seamless」向内隐形：
// FAB 是 X compose 同款 56px 圆钮、操作栏是跟随主题的工具条（X switch / 步进器 / 胶囊按钮）、
// 勾选是 22px 圆圈、弹窗是 X Dialog 同构（✕ 左上 / 主按钮右上）、Toast 蓝底白字自底部升起。
// 全部 SVG 图标、零 emoji。
//
// 主题跟随：所有顶层 UI 根元素注册进 roots，applyTheme(tokens) 经 CSSOM 把 --xs-* 变量
// 写在根元素上（x.com CSP 拦 <style> 注入，但 style.setProperty 属 CSSOM，不拦）。
// 结构与静态样式在 manifest 注入的 content.css 里（合法注入通道，可用类与变量）。
//
// 「哑视图」原则不变：只构造 DOM 与暴露交互回调，状态与编排留在 content.js。挂 XS.ui.*。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});
  const MAX = 20;

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // ---------- SVG 图标（X 官方 24×24 路径，fill 走 currentColor/CSS）----------
  const ICONS = {
    share: 'M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z',
    close: 'M10.59 12L4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42z',
    check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    flame: 'M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z',
  };

  function svgIcon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', ICONS[name] || '');
    svg.appendChild(p);
    return svg;
  }

  // ---------- 主题跟随：token → CSS 变量，写到所有存活的 UI 根元素 ----------
  const roots = new Set();
  let currentTokens = null;

  function setVars(el, t) {
    if (!el || !t) return;
    const dark = t.key !== 'light';
    const s = el.style;
    s.setProperty('--xs-bg', t.bg);
    s.setProperty('--xs-text', t.text);
    s.setProperty('--xs-text2', t.text2);
    s.setProperty('--xs-border', t.border);
    s.setProperty('--xs-input-border', t.inputBorder);
    s.setProperty('--xs-elev', t.elev);
    s.setProperty('--xs-accent', t.accent);
    s.setProperty('--xs-accent-hover', t.accentHover);
    s.setProperty('--xs-mask', dark ? 'rgba(91,112,131,0.4)' : 'rgba(0,0,0,0.4)');
    s.setProperty('--xs-shadow', dark
      ? 'rgba(255,255,255,0.2) 0 0 15px, rgba(255,255,255,0.15) 0 0 3px 1px'
      : 'rgba(101,119,134,0.2) 0 0 15px, rgba(101,119,134,0.15) 0 0 3px 1px');
  }

  function register(el) {
    roots.add(el);
    if (currentTokens) setVars(el, currentTokens);
    return el;
  }

  // content.js 检测到 X 主题变化时调用；顺手清理已脱离文档的根元素
  function applyTheme(tokens) {
    currentTokens = tokens;
    for (const el of roots) {
      if (!el.isConnected && el.parentNode == null) { roots.delete(el); continue; }
      setVars(el, tokens);
    }
  }

  // ---------- FAB：X compose 同款 56px 圆钮 ----------
  function makeFab(onClick) {
    const fab = document.createElement('button');
    fab.className = 'xs-fab';
    fab.title = '生成转发卡片（⌥点击=按上次配置直接复制）';
    fab.setAttribute('aria-label', '生成转发卡片');
    fab.appendChild(svgIcon('share'));
    fab.addEventListener('click', onClick);
    return register(fab);
  }

  // ---------- 勾选圆圈（22px）与主推文标记，供 decorateArticles 使用 ----------
  function checkCircle() {
    const c = document.createElement('div');
    c.className = 'xs-chip';
    c.appendChild(svgIcon('check'));
    return c; // .on 由调用方切换
  }
  function mainBadge() {
    const b = document.createElement('div');
    b.className = 'xs-badge';
    b.textContent = '主推文';
    return b;
  }

  // ---------- X 风格开关 ----------
  function mkSwitch(text, on, disabled, title) {
    const label = document.createElement('label');
    label.className = 'xs-swlabel' + (disabled ? ' disabled' : '');
    if (title) label.title = title;
    label.appendChild(document.createTextNode(text + ' '));
    const sw = document.createElement('span');
    sw.className = 'xs-switch' + (on ? ' on' : '');
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(!!on));
    label.appendChild(sw);
    let state = !!on;
    const api = {
      label,
      isOn: () => state,
      setOn: (v) => { state = !!v; sw.classList.toggle('on', state); sw.setAttribute('aria-checked', String(state)); },
    };
    if (!disabled) {
      label.addEventListener('click', (e) => { e.preventDefault(); api.setOn(!state); if (api.onChange) api.onChange(state); });
    }
    return api;
  }

  // ---------- 分段胶囊控件 ----------
  // items: [{value, text}]；返回 { el, value(), setValue(v) }，onChange(v) 可挂
  function mkSegmented(items, value) {
    const seg = document.createElement('span');
    seg.className = 'xs-seg';
    const btns = new Map();
    let cur = value;
    const api = {
      el: seg,
      value: () => cur,
      setValue: (v) => { cur = v; btns.forEach((b, val) => b.classList.toggle('on', val === v)); },
    };
    items.forEach((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.text;
      if (it.value === value) b.classList.add('on');
      b.addEventListener('click', () => {
        if (cur === it.value) return;
        api.setValue(it.value);
        if (api.onChange) api.onChange(it.value);
      });
      btns.set(it.value, b);
      seg.appendChild(b);
    });
    return api;
  }

  function btn(cls, text, onClick) {
    const b = document.createElement('button');
    b.className = 'xs-btn ' + cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function divider() {
    const d = document.createElement('span');
    d.className = 'xs-bardiv';
    return d;
  }

  // ---------- 底部操作栏（设计稿 §05 mock 结构）----------
  // opts: { hasKey, translateDefault, redactMode, redactEnabled, autoHotN, maxReplies,
  //         defaultAutoN, onAuto, onAutoNChange, onGenImage, onGenWeb, onCancel }
  // 返回 { el, setCount, isTranslate, isRedact, autoN }
  function buildBar(opts) {
    const maxReplies = opts.maxReplies || MAX;
    const defaultAutoN = opts.defaultAutoN || 10;

    const bar = document.createElement('div');
    bar.className = 'xs-bar';

    const barCount = document.createElement('span');
    barCount.className = 'xs-barcount';
    bar.appendChild(barCount);
    bar.appendChild(divider());

    // 自动选热门：火焰 SVG + 文字按钮 + 内联步进器
    const autoWrap = document.createElement('span');
    autoWrap.className = 'xs-autowrap';
    autoWrap.appendChild(svgIcon('flame'));
    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = 'xs-autobtn';
    autoBtn.textContent = '自动选热门';
    autoBtn.title = '滚动评论区、按热度自动选出前 N 条，之后仍可手动增减';
    autoBtn.addEventListener('click', opts.onAuto);
    autoWrap.appendChild(autoBtn);

    let autoN = clamp(parseInt(opts.autoHotN, 10) || defaultAutoN, 1, maxReplies);
    const stepper = document.createElement('span');
    stepper.className = 'xs-stepper';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = String(autoN);
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    const bump = (d) => {
      autoN = clamp(autoN + d, 1, maxReplies);
      val.textContent = String(autoN);
      opts.onAutoNChange && opts.onAutoNChange(autoN); // 记住条数，下次沿用
    };
    minus.addEventListener('click', () => bump(-1));
    plus.addEventListener('click', () => bump(1));
    stepper.appendChild(minus);
    stepper.appendChild(val);
    stepper.appendChild(plus);
    autoWrap.appendChild(stepper);
    bar.appendChild(autoWrap);
    bar.appendChild(divider());

    const swTrans = mkSwitch(
      '翻译',
      opts.hasKey && opts.translateDefault,
      !opts.hasKey,
      opts.hasKey ? '附中文翻译' : '未配置 DeepSeek API Key——点扩展图标打开设置填入'
    );
    bar.appendChild(swTrans.label);

    const isModel = opts.redactMode === 'model';
    const swRedact = mkSwitch(
      `打码${isModel ? '·模型' : ''}`,
      opts.redactEnabled,
      false,
      isModel
        ? '用模型(LLM)识别并屏蔽敏感文字；可在设置里改为规则模式'
        : '按设置里的屏蔽词表(正则)屏蔽敏感文字；未填词表则不会改动内容'
    );
    bar.appendChild(swRedact.label);
    bar.appendChild(divider());

    // 生成网页降为白底描边次级——一屏两个高饱和主按钮互相打架，且绿色在 X 语义里是「转推」
    bar.appendChild(btn('pri', '生成长图', opts.onGenImage));
    bar.appendChild(btn('sec', '生成网页', opts.onGenWeb));
    bar.appendChild(btn('ghost', '取消', opts.onCancel));

    return {
      el: register(bar),
      setCount: (n) => { barCount.textContent = `已选 ${n} 条`; },
      isTranslate: () => swTrans.isOn(),
      isRedact: () => swRedact.isOn(),
      autoN: () => autoN,
    };
  }

  // ---------- 遮罩（单例）----------
  let overlay, overlayText;
  function showOverlay(text) {
    overlay = document.createElement('div');
    overlay.className = 'xs-overlay';
    const box = document.createElement('div');
    box.className = 'box';
    const spin = document.createElement('div');
    spin.className = 'xs-spin';
    box.appendChild(spin);
    overlayText = document.createElement('div');
    overlayText.textContent = text;
    box.appendChild(overlayText);
    overlay.appendChild(box);
    document.body.appendChild(register(overlay));
  }
  function setOverlay(text) { if (overlayText) overlayText.textContent = text; }
  function hideOverlay() { if (overlay) { roots.delete(overlay); overlay.remove(); overlay = null; overlayText = null; } }

  // ---------- Toast：X 原生样式（样式在 CSS；蓝底白字自底部升起）----------
  let toastTimer = null;
  function toast(text) {
    let t = document.querySelector('.xs-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'xs-toast';
      document.body.appendChild(register(t));
    }
    t.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { roots.delete(t); t.remove(); }, 2500);
  }

  // ---------- 弹窗骨架：X Dialog 同构（✕ 左上 / 可选主按钮右上）----------
  // 返回 { el, panel, foot, status, setStatus, addFoot, setHeadAction, destroy }
  function makeModal(title, onClose) {
    const modal = document.createElement('div');
    modal.className = 'xs-modal';
    const panel = document.createElement('div');
    panel.className = 'panel';

    const head = document.createElement('div');
    head.className = 'ph';
    const close = document.createElement('button');
    close.className = 'xs-dlgx';
    close.setAttribute('aria-label', '关闭');
    close.appendChild(svgIcon('close'));
    close.addEventListener('click', () => { if (onClose) onClose(); });
    head.appendChild(close);
    const titleEl = document.createElement('span');
    titleEl.className = 'title';
    titleEl.textContent = title;
    head.appendChild(titleEl);
    panel.appendChild(head);

    const foot = document.createElement('div');
    foot.className = 'pf';
    const status = document.createElement('span');
    status.className = 'status';

    modal.appendChild(panel);
    document.body.appendChild(register(modal));
    return {
      el: modal, panel, foot, status,
      setStatus: (t) => { status.textContent = t || ''; },
      addFoot: () => { foot.appendChild(status); panel.appendChild(foot); },
      setHeadAction: (node) => head.appendChild(node), // 主按钮右上，与 X compose 一致
      destroy: () => { roots.delete(modal); modal.remove(); },
    };
  }

  // ---------- 剪贴板 / 下载 ----------
  function downloadUrl(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }
  async function copyBlob(blob) {
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); return true; }
    catch (_) { return false; }
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (_) { return false; }
  }
  // 富文本复制：同时写 text/html 与 text/plain，粘贴进公众号/文档时保留排版与图片
  async function copyRich(html, plain) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain || ''], { type: 'text/plain' }),
        }),
      ]);
      return true;
    } catch (_) { return false; }
  }

  // 腾讯文档 pending 任务的标题：作者名 + 正文摘要（走 fmt.buildTitle 收敛，截断到 ~40 字）。
  function txdocsTitle(main) {
    if (!main) return '推文转发';
    const name = main.name || main.handle || '';
    const text = main.plainText || (main.segments ? main.segments.map((s) => s.text).join('') : '');
    return XS.buildTitle(name, text);
  }

  // ---------- 长图预览 · 成图控制台（设计稿 §05 Dialog mock）----------
  // opts: {
  //   blob, note, settings: { ratio, theme, style, showEng, showTime, showFooter },
  //   filename,
  //   onRerender(settings) -> Promise<{ blob, note }>,   // 控件改动 → 重渲染
  //   onSettingsChange(settings),                        // 持久化选择
  //   onClose,
  // }
  function showCardConsole(opts) {
    let blob = opts.blob;
    let objUrl = URL.createObjectURL(blob);
    const settings = Object.assign({}, opts.settings);

    const m = makeModal('转发长图', () => {
      URL.revokeObjectURL(objUrl);
      m.destroy();
      opts.onClose && opts.onClose();
    });

    // 主按钮右上：复制图片
    const copyTop = btn('pri', '复制图片', async () => {
      const ok = await copyBlob(blob);
      m.setStatus(ok ? '已复制，去微信里粘贴即可' : '复制失败，请用「下载 PNG」');
    });
    m.setHeadAction(copyTop);

    // 预览区
    const imWrap = document.createElement('div');
    imWrap.className = 'pim';
    const img = document.createElement('img');
    img.src = objUrl;
    imWrap.appendChild(img);
    m.panel.appendChild(imWrap);

    // 控制台
    const con = document.createElement('div');
    con.className = 'xs-console';
    const row = (k, node) => {
      const r = document.createElement('div');
      r.className = 'xs-ctrlrow';
      const key = document.createElement('span');
      key.className = 'k';
      key.textContent = k;
      r.appendChild(key);
      r.appendChild(node);
      con.appendChild(r);
      return r;
    };

    let busy = false;
    let pending = false;
    async function rerender() {
      // 渲染中又来一次改动：置 pending，当前这轮结束后再用「最新 settings」补跑一轮，
      // 避免旧实现「busy 时直接 return」把渲染中的改动静默吞掉（settings 变了却不重渲染）。
      if (busy) { pending = true; return; }
      busy = true;
      img.classList.add('rendering');
      m.setStatus('重新渲染…');
      try {
        const r = await opts.onRerender(Object.assign({}, settings));
        blob = r.blob;
        URL.revokeObjectURL(objUrl);
        objUrl = URL.createObjectURL(blob);
        img.src = objUrl;
        m.setStatus(r.note || '');
      } catch (e) {
        m.setStatus('渲染失败：' + ((e && e.message) || e));
      } finally {
        img.classList.remove('rendering');
        busy = false;
        if (pending) { pending = false; rerender(); } // 补跑一轮，带上期间累计的最新 settings
      }
    }
    const changed = (key) => (v) => {
      settings[key] = v;
      opts.onSettingsChange && opts.onSettingsChange(Object.assign({}, settings));
      rerender();
    };

    const segRatio = mkSegmented([
      { value: 'smart', text: '智能长图' },
      { value: '4:5', text: '4:5' },
      { value: '1:1', text: '1:1' },
      { value: '3:4', text: '3:4' },
      { value: '9:16', text: '9:16' },
    ], settings.ratio || 'smart');
    segRatio.onChange = changed('ratio');
    row('比例', segRatio.el);

    const segTheme = mkSegmented([
      { value: 'follow', text: '跟随X' },
      { value: 'light', text: '浅色' },
      { value: 'dim', text: '暗蓝' },
      { value: 'lightsout', text: '纯黑' },
    ], settings.theme || 'follow');
    segTheme.onChange = changed('theme');
    row('主题', segTheme.el);

    const segStyle = mkSegmented([
      { value: 'native', text: 'X 原生风' },
      { value: 'reading', text: '阅读排版风' },
    ], settings.style || 'native');
    segStyle.onChange = changed('style');
    row('样式', segStyle.el);

    const disp = document.createElement('span');
    disp.className = 'xs-disp';
    const swEng = mkSwitch('互动数据', settings.showEng !== false);
    swEng.onChange = changed('showEng');
    const swTime = mkSwitch('时间', settings.showTime !== false);
    swTime.onChange = changed('showTime');
    const swFoot = mkSwitch('落款', !!settings.showFooter, false, '底部的原文链接行；关闭则成图零工具痕迹');
    swFoot.onChange = changed('showFooter');
    disp.appendChild(swEng.label);
    disp.appendChild(swTime.label);
    disp.appendChild(swFoot.label);
    row('显示', disp);

    m.panel.appendChild(con);

    // 底部：下载 PNG + 状态 + 复制图片
    m.foot.appendChild(btn('sec', '下载 PNG', () => {
      downloadUrl(objUrl, opts.filename || 'x-card.png');
      m.setStatus('已下载');
    }));
    m.foot.appendChild(btn('pri', '复制图片', async () => {
      const ok = await copyBlob(blob);
      m.setStatus(ok ? '已复制，去微信里粘贴即可' : '复制失败，请用「下载 PNG」');
    }));
    m.addFoot();
    if (opts.note) m.setStatus(opts.note);

    // 尝试自动复制（可能因失去用户手势而失败，失败就靠按钮）
    copyBlob(blob).then((ok) => { if (ok && !opts.note) m.setStatus('已自动复制，去微信里粘贴即可'); });
  }

  // ---------- 网页预览 ----------
  // opts: { mainData, mainId, cfg, getCfg, onClose }
  function showWebpagePreview(html, rich, plain, note, opts) {
    const cfg = opts.cfg || {};
    const objUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const m = makeModal('转发网页', () => {
      URL.revokeObjectURL(objUrl);
      m.destroy();
      opts.onClose && opts.onClose();
    });

    const info = document.createElement('div');
    info.className = 'pweb';
    const kb = Math.round(html.length / 1024);
    info.innerHTML =
      `<p>已生成一个自包含网页（${kb} KB，含内联图片，可离线打开）。</p>` +
      `<p class="hint"><b>推荐「复制图文」</b>：直接粘贴进公众号后台 / 语雀 / 飞书 / 腾讯文档 / 印象笔记，由这些平台生成链接——免服务器、免备案、微信最友好。` +
      `<br>「发布并复制链接」走你配置的后端；Gist / 多数境外托管在大陆常打不开且易被微信拦截，仅适合境外接收者或存档。境内稳定链接建议自建香港服务器或腾讯云 CloudBase（见 README）。</p>`;
    m.panel.appendChild(info);

    // 新标签预览（顶层导航到 blob，不受页面 frame-src CSP 限制）
    const preview = document.createElement('a');
    preview.className = 'xs-btn sec';
    preview.textContent = '新标签预览';
    preview.href = objUrl;
    preview.target = '_blank';
    preview.rel = 'noopener';
    m.foot.appendChild(preview);

    m.foot.appendChild(btn('sec', '下载 HTML', () => {
      downloadUrl(objUrl, `x-tweet-${(opts && opts.mainId) || 'page'}.html`);
      m.setStatus('已下载');
    }));

    m.foot.appendChild(btn('pri', '复制图文', async () => {
      const ok = await copyRich(rich, plain);
      m.setStatus(ok
        ? '图文已复制，去公众号/语雀/飞书/腾讯文档/印象笔记粘贴，由平台生成链接'
        : '复制失败，请改用「下载 HTML」');
    }));

    // 发布到腾讯文档（引导式半自动）：无条件显示，不依赖 publishTarget 配置。
    // 主通道是系统剪贴板——在用户手势内用 copyRich 把图文写入剪贴板，再存 pending
    // 任务、开 docs.qq.com/desktop 新标签，由 txdocs.js 挂引导浮层、按状态机推进。
    m.foot.appendChild(btn('sec', '发布到腾讯文档', async () => {
      const ok = await copyRich(rich, plain);
      if (!ok) { m.setStatus('复制失败，无法发布到腾讯文档（图文需先进剪贴板）'); return; }
      try {
        await chrome.storage.local.set({
          xsTxdocsPending: {
            html: rich,
            plain: plain || '',
            title: txdocsTitle(opts.mainData),
            ts: Date.now(),
          },
        });
      } catch (e) {
        m.setStatus('准备失败：' + ((e && e.message) || e));
        return;
      }
      window.open('https://docs.qq.com/desktop', '_blank', 'noopener');
      m.setStatus('已复制图文，请在新打开的腾讯文档标签按右下角向导操作（登录后按一次 ⌘V 粘贴）');
    }));

    if (cfg.publishTarget !== 'none') {
      const label = cfg.publishTarget === 'gist' ? '发布到 Gist 并复制链接'
        : cfg.publishTarget === 'cloudbase' ? '发布到 CloudBase 并复制链接'
        : '发布并复制链接';
      const pub = btn('pri', label, async () => {
        // 点击时取实时配置（配置实时生效：弹窗开着时去设置页配好后端，回来直接能发）
        const live = opts.getCfg ? opts.getCfg() : cfg;
        if (!live.publishConfigured) { m.setStatus('发布后端未配置好，请到设置页填写'); return; }
        pub.disabled = true;
        m.setStatus('发布中…');
        try {
          const r = await XS.rpc.publish(html);
          if (r.ok && r.url) {
            const okCopy = await copyText(r.url);
            m.setStatus((okCopy ? '链接已复制 ' : '') + r.url);
          } else {
            m.setStatus('发布失败：' + (r.error || '未知错误'));
          }
        } catch (e) {
          m.setStatus('发布失败：' + ((e && e.message) || e));
        } finally {
          pub.disabled = false;
        }
      });
      m.foot.appendChild(pub);
    }

    m.addFoot();
    if (note) m.setStatus(note);
  }

  XS.ui = {
    applyTheme,
    makeFab,
    checkCircle,
    mainBadge,
    mkSwitch,
    mkSegmented,
    btn,
    buildBar,
    showOverlay,
    setOverlay,
    hideOverlay,
    toast,
    makeModal,
    downloadUrl,
    copyBlob,
    copyText,
    copyRich,
    showCardConsole,
    showWebpagePreview,
  };
})();
