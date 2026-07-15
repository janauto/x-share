// 主流程编排：状态 + 事件接线。UI 组件在 ui/widgets.js，数据管线在 pipeline.js，
// 渲染在 render/*，数据提取在 extract.js。这里只做「悬浮按钮 → 评论勾选 → 触发管线 → 预览」。
//
// 注意：X 的时间线是虚拟滚动，回复滚出视野后 DOM 会被回收，
// 所以勾选的瞬间就要把数据提取缓存下来（state.selected 存的是数据不是元素）。

(() => {
  if (window.__XS_CONTENT_LOADED) return;
  window.__XS_CONTENT_LOADED = true;

  const XS = window.__XS;
  const MAX_REPLIES = 20;
  const DEFAULT_AUTO_N = 10;

  const state = {
    selecting: false,
    generating: false,
    mainData: null,
    mainId: null,
    selected: new Map(), // id -> tweetData（勾选时立即提取）
    hasKey: false,
    translateDefault: true,
    cfg: {
      autoHotDefault: true, autoHotN: 10,
      cardTheme: 'follow', cardStyle: 'native', cardRatio: 'smart',
      cardShowEng: true, cardShowTime: true, cardShowFooter: false,
      redactEnabled: false, redactMode: 'rules', redactTerms: '',
      redactPII: false, redactImages: false,
      publishTarget: 'none', publishConfigured: false,
    },
  };

  let fab, bar, observer;

  init();

  function init() {
    // ⌥点击 FAB = 零摩擦通道（跳过选择与预览，按上次配置直接复制）；普通点击进选择模式
    fab = XS.ui.makeFab((e) => { if (e && e.altKey) quickGenerate(); else enterSelection(); });
    document.body.appendChild(fab);

    setInterval(syncFab, 800);
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKeydown, true);

    // 页面 UI 恒跟随 X 当前主题（与成图的「主题」选择相互独立）：
    // 初次应用 + 监听 body 属性变化（X 切主题会改写 body 的背景样式）
    XS.ui.applyTheme(XS.theme.themeFor('follow'));
    const themeWatch = debounce(() => XS.ui.applyTheme(XS.theme.themeFor('follow')), 200);
    new MutationObserver(themeWatch).observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });

    // 配置实时生效：设置页改动后 storage 变化即刷新（正在生成中时下一次生成生效即可）
    chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') refreshConfig(); });
    refreshConfig();
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && state.selecting && !state.generating) { exitSelection(); return; }
    // Shift+S 零摩擦通道（详情页、非输入场景、非选择模式）
    if (e.key === 'S' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (!typing && !state.selecting && XS.isStatusPage()) { e.preventDefault(); e.stopPropagation(); quickGenerate(); }
    }
  }

  async function refreshConfig() {
    try {
      const c = await XS.rpc.getConfig();
      if (c) applyConfig(c);
    } catch (_) { /* 忽略：保持上次配置 */ }
  }

  function applyConfig(c) {
    state.hasKey = !!c.hasKey;
    state.translateDefault = c.translateDefault !== false;
    state.cfg = {
      autoHotDefault: c.autoHotDefault !== false,
      autoHotN: c.autoHotN || 10,
      cardTheme: c.cardTheme || 'follow',
      cardStyle: c.cardStyle === 'reading' ? 'reading' : 'native',
      cardRatio: c.cardRatio || 'smart',
      cardShowEng: c.cardShowEng !== false,
      cardShowTime: c.cardShowTime !== false,
      cardShowFooter: !!c.cardShowFooter,
      redactEnabled: !!c.redactEnabled,
      redactMode: c.redactMode || 'rules',
      redactTerms: c.redactTerms || '',
      redactPII: !!c.redactPII,
      redactImages: !!c.redactImages,
      publishTarget: c.publishTarget || 'none',
      publishConfigured: !!c.publishConfigured,
    };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function attachObserver() {
    observer = new MutationObserver(debounce(decorateArticles, 300));
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function syncFab() {
    const show = XS.isStatusPage() && !state.selecting;
    fab.style.display = show ? 'flex' : 'none';
    if (!XS.isStatusPage() && state.selecting && !state.generating) exitSelection();
  }

  // ---------- 选择模式 ----------

  function enterSelection() {
    // X 长文(Article)现在由 extract.js 的兜底逻辑正确解析正文，不再需要在此处拦截。
    const main = XS.findMainArticle();
    if (!main) { XS.ui.toast('还没找到推文，等页面加载完成后再试'); return; }
    const data = XS.extractTweet(main);
    if (!data) { XS.ui.toast('推文解析失败（页面结构可能已变化）'); return; }

    state.selecting = true;
    state.mainData = data;
    state.mainId = data.id || XS.locationTweetId();
    state.selected.clear();

    fab.style.display = 'none';
    buildBar();
    decorateArticles();
    attachObserver();

    if (state.cfg.autoHotDefault) autoSelectHot(); // 默认进入即自动按热度选取，之后仍可手动增减
    else XS.ui.toast('点击评论勾选，或用「自动选热门」一键筛选');
  }

  function exitSelection() {
    state.selecting = false;
    state.selected.clear();
    if (observer) { observer.disconnect(); observer = null; }
    if (bar) { bar.el.remove(); bar = null; }
    document.querySelectorAll('.xs-chip, .xs-badge').forEach((n) => n.remove());
    document.querySelectorAll('article.xs-selected').forEach((a) => a.classList.remove('xs-selected'));
    document.querySelectorAll('article[data-xs-done]').forEach((a) => delete a.dataset.xsDone);
    syncFab();
  }

  function decorateArticles() {
    if (!state.selecting) return;
    document.querySelectorAll('article[data-testid="tweet"]').forEach((article) => {
      const id = XS.quickTweetId(article);
      if (!id) return;
      if (getComputedStyle(article).position === 'static') article.style.position = 'relative';

      let mark = article.querySelector(':scope > .xs-chip, :scope > .xs-badge');
      if (id === state.mainId) {
        if (!mark || !mark.classList.contains('xs-badge')) {
          if (mark) mark.remove();
          article.appendChild(XS.ui.mainBadge());
        }
        return;
      }
      if (!mark || !mark.classList.contains('xs-chip')) {
        if (mark) mark.remove();
        mark = XS.ui.checkCircle(); // 22px 勾选圆圈（X 相册选择器同款），左上角避开 ⋯
        article.appendChild(mark);
      }
      const on = state.selected.has(id);
      mark.classList.toggle('on', on);
      article.classList.toggle('xs-selected', on);
    });
  }

  function onDocClick(e) {
    if (!state.selecting || state.generating) return;
    if (e.target.closest('.xs-bar, .xs-fab, .xs-overlay, .xs-modal, .xs-toast')) return;
    const article = e.target.closest('article[data-testid="tweet"]');
    if (!article) return;
    e.preventDefault();
    e.stopPropagation();
    toggleArticle(article);
  }

  function toggleArticle(article) {
    const id = XS.quickTweetId(article);
    if (!id || id === state.mainId) return;
    if (state.selected.has(id)) {
      state.selected.delete(id);
    } else {
      if (state.selected.size >= MAX_REPLIES) { XS.ui.toast(`最多选择 ${MAX_REPLIES} 条评论`); return; }
      const d = XS.extractTweet(article);
      if (!d) { XS.ui.toast('这条评论解析失败'); return; }
      state.selected.set(id, d);
    }
    decorateArticles();
    updateBar();
  }

  // ---------- 操作栏 ----------

  function buildBar() {
    bar = XS.ui.buildBar({
      hasKey: state.hasKey,
      translateDefault: state.translateDefault,
      redactMode: state.cfg.redactMode,
      redactEnabled: state.cfg.redactEnabled,
      autoHotN: state.cfg.autoHotN,
      maxReplies: MAX_REPLIES,
      defaultAutoN: DEFAULT_AUTO_N,
      onAuto: autoSelectHot,
      onAutoNChange: (n) => { state.cfg.autoHotN = n; chrome.storage.local.set({ autoHotN: n }); },
      onGenImage: generateImage,
      onGenWeb: generateWebpage,
      onCancel: exitSelection,
    });
    document.body.appendChild(bar.el);
    updateBar();
  }

  function updateBar() { if (bar) bar.setCount(state.selected.size); }

  // ---------- 自动选热门评论 ----------

  async function autoSelectHot() {
    if (state.generating) return;
    const N = bar.autoN();
    state.generating = true; // 借用锁，避免滚动期间误触
    if (observer) { observer.disconnect(); observer = null; }
    XS.ui.showOverlay('加载并评估评论…');

    const harvest = new Map();
    const startY = window.scrollY;
    // 收尾（解锁 / 重挂 observer / 关遮罩）必须在 finally 里，否则收割中任一处抛错会卡死。
    try {
      let stagnant = 0;
      for (let i = 0; i < 25 && stagnant < 3; i++) {
        let added = 0;
        document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
          const id = XS.quickTweetId(a);
          if (!id || id === state.mainId || harvest.has(id)) return;
          const d = XS.extractTweet(a);
          if (d) { harvest.set(id, d); added++; }
        });
        XS.ui.setOverlay(`已评估 ${harvest.size} 条评论…`);
        stagnant = added ? 0 : stagnant + 1;
        if (harvest.size >= Math.max(N * 4, N + 15)) break;
        window.scrollBy(0, Math.round(window.innerHeight * 0.9));
        await sleep(550);
      }

      const ranked = [...harvest.values()].sort(
        (a, b) => (b.engagement ? b.engagement.score : 0) - (a.engagement ? a.engagement.score : 0)
      );
      state.selected.clear();
      ranked.slice(0, N).forEach((d) => state.selected.set(d.id, d));
      if (!harvest.size) XS.ui.toast('没抓到评论，可能页面还没加载出回复');
      else XS.ui.toast(`已按热度自动选中 ${state.selected.size} 条，可继续手动增减`);
    } catch (e) {
      XS.ui.toast('自动选热门失败：' + ((e && e.message) || e));
    } finally {
      window.scrollTo(0, startY);
      state.generating = false;
      attachObserver();
      decorateArticles();
      updateBar();
      XS.ui.hideOverlay();
    }
  }

  // ---------- 生成流程 ----------

  // settings（比例/主题/样式/显示）→ payload 视图 → PNG。控制台每次改动都走这里重渲染。
  async function renderCardWith(payload, settings) {
    payload.theme = XS.theme.themeFor(settings.theme);
    payload.cardStyle = settings.style;
    payload.show = { eng: settings.showEng, time: settings.showTime, footer: settings.showFooter };
    const card = XS.buildCard(payload);
    const r = await XS.renderCardToPng(card, { ratio: settings.ratio });
    return { blob: r.blob, note: XS.pipeline.joinNotes(payload.note, r.note) };
  }

  function cardSettings() {
    return {
      ratio: state.cfg.cardRatio,
      theme: state.cfg.cardTheme,
      style: state.cfg.cardStyle,
      showEng: state.cfg.cardShowEng,
      showTime: state.cfg.cardShowTime,
      showFooter: state.cfg.cardShowFooter,
    };
  }

  function persistCardSettings(s) {
    Object.assign(state.cfg, {
      cardRatio: s.ratio, cardTheme: s.theme, cardStyle: s.style,
      cardShowEng: s.showEng, cardShowTime: s.showTime, cardShowFooter: s.showFooter,
    });
    chrome.storage.local.set({
      cardRatio: s.ratio, cardTheme: s.theme, cardStyle: s.style,
      cardShowEng: s.showEng, cardShowTime: s.showTime, cardShowFooter: s.showFooter,
    });
  }

  // 文件名可选 iPhone 风格（保真清单）：IMG_ + 推文 id 后四位
  function cardFilename() {
    const id = String(state.mainId || '').replace(/\D/g, '');
    return `IMG_${(id.slice(-4) || '0001').padStart(4, '0')}.PNG`;
  }

  async function generateImage() {
    await runGenerate(async (payload) => {
      XS.ui.setOverlay('渲染长图…');
      const settings = cardSettings();
      const first = await renderCardWith(payload, settings);
      XS.ui.hideOverlay();
      XS.ui.showCardConsole({
        blob: first.blob,
        note: first.note,
        settings,
        filename: cardFilename(),
        onRerender: (s) => renderCardWith(payload, s),
        onSettingsChange: persistCardSettings,
        onClose: onPreviewClose,
      });
    });
  }

  async function generateWebpage() {
    await runGenerate(async (payload) => {
      XS.ui.setOverlay('生成网页…');
      payload.theme = XS.theme.themeFor(state.cfg.cardTheme);
      const html = XS.buildWebpageHtml(payload);
      const rich = XS.buildRichHtml(payload);
      const plain = XS.buildPlainText(payload);
      XS.ui.hideOverlay();
      XS.ui.showWebpagePreview(html, rich, plain, payload.note, {
        mainData: state.mainData, mainId: state.mainId,
        cfg: state.cfg, getCfg: () => state.cfg, // getCfg：发布按钮点击时取实时配置
        onClose: onPreviewClose,
      });
    });
  }

  // ---------- 零摩擦通道（设计 §03 快速通道 / 排期 P3）----------
  // ⌥点击 FAB / Shift+S / 分享菜单「以图片分享」→ 跳过选择与预览，按上次配置
  // 直接生成主推文长图进剪贴板 + X 原生 Toast。data 缺省时提取当前主推文。
  async function quickGenerate(data) {
    if (state.generating) return;
    let main = data || null;
    if (!main) {
      const article = XS.findMainArticle();
      main = article && XS.extractTweet(article);
    }
    if (!main) { XS.ui.toast('没找到可分享的推文'); return; }

    state.generating = true;
    XS.ui.showOverlay('生成中…');
    try {
      await XS.pipeline.inlineImages(main);
      if (state.hasKey && state.translateDefault) {
        XS.ui.setOverlay('翻译中…');
        await XS.pipeline.translateAll(main, []);
      }
      const payload = await XS.pipeline.redactedClone({ main, replies: [] }, {
        redact: state.cfg.redactEnabled,
        cfg: state.cfg,
        onStage: (t) => XS.ui.setOverlay(t),
      });
      payload.note = payload.redactNote;
      XS.ui.setOverlay('渲染长图…');
      const r = await renderCardWith(payload, cardSettings());
      XS.ui.hideOverlay();
      const ok = await XS.ui.copyBlob(r.blob);
      if (ok) XS.ui.toast('已复制，去微信粘贴即可');
      else { XS.ui.downloadUrl(URL.createObjectURL(r.blob), cardFilename()); XS.ui.toast('剪贴板不可用，已改为下载 PNG'); }
    } catch (e) {
      XS.ui.hideOverlay();
      XS.ui.toast('生成失败：' + ((e && e.message) || e));
    } finally {
      state.generating = false;
    }
  }
  XS.quickShare = quickGenerate; // 供 share-menu.js（分享菜单注入）调用

  // 预览关闭时的编排收尾：复位生成锁、退出选择模式
  function onPreviewClose() {
    state.generating = false;
    exitSelection();
  }

  // 共享管线：抓图（缓存）→ 翻译（缓存）→ 克隆 → 打码 → 交给 render 回调
  async function runGenerate(render) {
    if (state.generating) return;
    if (!state.mainData) { XS.ui.toast('没有可用的推文数据'); return; }
    state.generating = true;
    XS.ui.showOverlay('提取内容…');
    try {
      const main = state.mainData;
      const replies = [...state.selected.values()];

      XS.ui.setOverlay('转存图片…');
      await Promise.all([XS.pipeline.inlineImages(main), ...replies.map((r) => XS.pipeline.inlineImages(r))]);

      let transError = null;
      if (bar.isTranslate()) {
        XS.ui.setOverlay('翻译中…');
        transError = await XS.pipeline.translateAll(main, replies);
      }

      const payload = await XS.pipeline.redactedClone({ main, replies }, {
        redact: bar.isRedact(),
        cfg: state.cfg,
        onStage: (t) => XS.ui.setOverlay(t),
      });
      payload.note = XS.pipeline.joinNotes(transError, payload.redactNote);
      // 主题/样式/比例在渲染时解析（成图控制台可改动即重渲染），见 renderCardWith
      await render(payload);
    } catch (e) {
      XS.ui.hideOverlay();
      state.generating = false;
      XS.ui.toast('生成失败：' + ((e && e.message) || e));
    }
  }

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }
})();
