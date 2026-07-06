// 主流程：悬浮按钮 → 评论勾选模式 → 抓图/翻译 → 长图预览。
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
      redactEnabled: false, redactMode: 'rules', redactTerms: '',
      redactPII: false, redactImages: false,
      publishTarget: 'none', publishConfigured: false,
    },
  };

  let fab, bar, barCount, barTrans, barRedact, barAutoN, overlay, overlayText, modal, observer;

  init();

  function init() {
    fab = document.createElement('button');
    fab.className = 'xs-fab';
    fab.textContent = '📤 生成转发卡片';
    fab.addEventListener('click', enterSelection);
    document.body.appendChild(fab);

    setInterval(syncFab, 800);
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.selecting && !state.generating) exitSelection();
    }, true);

    chrome.runtime.sendMessage({ type: 'getConfig' })
      .then((c) => {
        if (c) {
          state.hasKey = !!c.hasKey;
          state.translateDefault = c.translateDefault !== false;
          state.cfg = {
            redactEnabled: !!c.redactEnabled,
            redactMode: c.redactMode || 'rules',
            redactTerms: c.redactTerms || '',
            redactPII: !!c.redactPII,
            redactImages: !!c.redactImages,
            publishTarget: c.publishTarget || 'none',
            publishConfigured: !!c.publishConfigured,
          };
        }
      })
      .catch(() => {});
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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
    const main = XS.findMainArticle();
    if (!main) { toast('还没找到推文，等页面加载完成后再试'); return; }
    const data = XS.extractTweet(main);
    if (!data) { toast('推文解析失败（页面结构可能已变化）'); return; }

    state.selecting = true;
    state.mainData = data;
    state.mainId = data.id || XS.locationTweetId();
    state.selected.clear();

    fab.style.display = 'none';
    buildBar();
    decorateArticles();
    attachObserver();

    toast('点击评论勾选，或用「🔥 自动选热门」一键筛选');
  }

  function exitSelection() {
    state.selecting = false;
    state.selected.clear();
    if (observer) { observer.disconnect(); observer = null; }
    if (bar) { bar.remove(); bar = null; }
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
          mark = document.createElement('div');
          mark.className = 'xs-badge';
          mark.textContent = '✓ 主推文';
          article.appendChild(mark);
        }
        return;
      }
      if (!mark || !mark.classList.contains('xs-chip')) {
        if (mark) mark.remove();
        mark = document.createElement('div');
        mark.className = 'xs-chip';
        article.appendChild(mark);
      }
      const on = state.selected.has(id);
      mark.textContent = on ? '✓ 已选' : '＋ 选择';
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
      if (state.selected.size >= MAX_REPLIES) { toast(`最多选择 ${MAX_REPLIES} 条评论`); return; }
      const d = XS.extractTweet(article);
      if (!d) { toast('这条评论解析失败'); return; }
      state.selected.set(id, d);
    }
    decorateArticles();
    updateBar();
  }

  // ---------- 底部操作栏 ----------

  function buildBar() {
    bar = document.createElement('div');
    bar.className = 'xs-bar';

    barCount = document.createElement('span');
    barCount.className = 'xs-barcount';
    bar.appendChild(barCount);

    // 自动选热门：数量输入 + 按钮
    const autoWrap = document.createElement('span');
    autoWrap.className = 'xs-autowrap';
    const autoBtn = document.createElement('button');
    autoBtn.className = 'xs-btn sec';
    autoBtn.textContent = '🔥 自动选热门';
    autoBtn.title = '滚动评论区、按热度自动选出前 N 条，之后仍可手动增减';
    autoBtn.addEventListener('click', autoSelectHot);
    autoWrap.appendChild(autoBtn);
    barAutoN = document.createElement('input');
    barAutoN.type = 'number';
    barAutoN.className = 'xs-num';
    barAutoN.min = '1';
    barAutoN.max = String(MAX_REPLIES);
    barAutoN.value = String(DEFAULT_AUTO_N);
    barAutoN.title = '自动选取的条数';
    autoWrap.appendChild(barAutoN);
    autoWrap.appendChild(document.createTextNode('条'));
    bar.appendChild(autoWrap);

    barTrans = mkCheck(
      state.hasKey ? '附中文翻译' : '附中文翻译（未配置 Key）',
      state.hasKey && state.translateDefault,
      !state.hasKey,
      !state.hasKey ? '先点扩展图标打开设置，填入 DeepSeek API Key' : ''
    );
    bar.appendChild(barTrans.label);

    barRedact = mkCheck('敏感打码', state.cfg.redactEnabled, false,
      '按设置里的规则/模型屏蔽敏感文字，可选给图片打码');
    bar.appendChild(barRedact.label);

    const genImg = document.createElement('button');
    genImg.className = 'xs-btn pri';
    genImg.textContent = '生成长图';
    genImg.addEventListener('click', generateImage);
    bar.appendChild(genImg);

    const genWeb = document.createElement('button');
    genWeb.className = 'xs-btn pri2';
    genWeb.textContent = '生成网页';
    genWeb.addEventListener('click', generateWebpage);
    bar.appendChild(genWeb);

    const cancel = document.createElement('button');
    cancel.className = 'xs-btn sec';
    cancel.textContent = '取消';
    cancel.addEventListener('click', exitSelection);
    bar.appendChild(cancel);

    document.body.appendChild(bar);
    updateBar();
  }

  function mkCheck(text, checked, disabled, title) {
    const label = document.createElement('label');
    if (title) label.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.disabled = disabled;
    label.appendChild(input);
    label.appendChild(document.createTextNode(text));
    return { label, input };
  }

  function updateBar() {
    if (barCount) barCount.textContent = `已选 ${state.selected.size} 条`;
  }

  // ---------- 自动选热门评论 ----------

  async function autoSelectHot() {
    if (state.generating) return;
    const N = clamp(parseInt(barAutoN.value, 10) || DEFAULT_AUTO_N, 1, MAX_REPLIES);
    state.generating = true; // 借用锁，避免滚动期间误触
    if (observer) { observer.disconnect(); observer = null; }
    showOverlay('加载并评估评论…');

    const harvest = new Map();
    const startY = window.scrollY;
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
        setOverlay(`已评估 ${harvest.size} 条评论…`);
        stagnant = added ? 0 : stagnant + 1;
        if (harvest.size >= Math.max(N * 4, N + 15)) break;
        window.scrollBy(0, Math.round(window.innerHeight * 0.9));
        await sleep(550);
      }
    } finally {
      window.scrollTo(0, startY);
    }

    const ranked = [...harvest.values()].sort(
      (a, b) => (b.engagement ? b.engagement.score : 0) - (a.engagement ? a.engagement.score : 0)
    );
    state.selected.clear();
    ranked.slice(0, N).forEach((d) => state.selected.set(d.id, d));

    state.generating = false;
    attachObserver();
    decorateArticles();
    updateBar();
    hideOverlay();
    if (!harvest.size) toast('没抓到评论，可能页面还没加载出回复');
    else toast(`已按热度自动选中 ${state.selected.size} 条，可继续手动增减`);
  }

  // ---------- 生成流程 ----------

  async function generateImage() {
    await runGenerate(async (payload) => {
      setOverlay('渲染长图…');
      const card = XS.buildCard(payload);
      const blob = await XS.renderCardToPng(card);
      hideOverlay();
      showImagePreview(blob, payload.note);
    });
  }

  async function generateWebpage() {
    await runGenerate(async (payload) => {
      setOverlay('生成网页…');
      const html = XS.buildWebpageHtml(payload);
      hideOverlay();
      showWebpagePreview(html, payload.note);
    });
  }

  // 共享管线：抓图（缓存）→ 翻译（缓存）→ 克隆 → 打码 → 交给 render 回调
  async function runGenerate(render) {
    if (state.generating) return;
    if (!state.mainData) { toast('没有可用的推文数据'); return; }
    state.generating = true;
    showOverlay('提取内容…');
    try {
      const main = state.mainData;
      const replies = [...state.selected.values()];

      setOverlay('转存图片…');
      await Promise.all([inlineImages(main), ...replies.map(inlineImages)]);

      let transError = null;
      if (barTrans.input.checked) {
        setOverlay('翻译中…');
        transError = await translateAll(main, replies);
      }

      const payload = await redactedClone({ main, replies });
      payload.note = joinNotes(transError, payload.redactNote);
      await render(payload);
    } catch (e) {
      hideOverlay();
      state.generating = false;
      toast('生成失败：' + ((e && e.message) || e));
    }
  }

  function joinNotes(a, b) {
    return [a, b].filter(Boolean).join('；') || null;
  }

  // 在克隆副本上做打码，保证原始缓存不被破坏（可重复生成、切换打码开关）
  async function redactedClone({ main, replies }) {
    const clone = structuredClone({ main, replies });
    let redactNote = null;
    if (barRedact.input.checked) {
      setOverlay('敏感内容处理…');
      if (state.cfg.redactMode === 'model') redactNote = await redactModel(clone);
      else redactRules(clone);
      if (state.cfg.redactImages) await pixelateImages(clone);
    }
    clone.redactNote = redactNote;
    return clone;
  }

  function redactRules(payload) {
    const terms = XS.compileRedactTerms(state.cfg.redactTerms, state.cfg.redactPII);
    if (!terms.length) return;
    const walk = (d) => {
      if (!d) return;
      if (d.segments) d.segments = d.segments.map((s) => ({ type: s.type, text: XS.redactText(s.text, terms) }));
      if (d.translation) d.translation = XS.redactText(d.translation, terms);
      if (d.quote) walk(d.quote);
    };
    walk(payload.main);
    payload.replies.forEach(walk);
  }

  // 模型屏蔽：整段送模型返回打码版；被改写的段落丢失实体高亮（合并为单段），可接受
  async function redactModel(payload) {
    const items = [];
    const walk = (d) => {
      if (!d) return;
      const orig = d.segments ? d.segments.map((s) => s.text).join('') : '';
      if (orig) items.push({ d, kind: 'orig', text: orig });
      if (d.translation) items.push({ d, kind: 'trans', text: d.translation });
      if (d.quote) walk(d.quote);
    };
    walk(payload.main);
    payload.replies.forEach(walk);
    if (!items.length) return null;

    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'redact', texts: items.map((i) => i.text) });
    } catch (e) {
      return '模型屏蔽失败，已按未打码生成：' + ((e && e.message) || e);
    }
    if (!resp || resp.error) {
      if (resp && resp.error === 'NO_KEY') return '未配置 API Key，无法用模型屏蔽';
      return '模型屏蔽失败：' + ((resp && resp.error) || '未知错误');
    }
    items.forEach((it, i) => {
      const r = resp.redacted[i];
      if (r == null) return;
      if (it.kind === 'orig') it.d.segments = [{ type: 'text', text: r }];
      else it.d.translation = r;
    });
    return null;
  }

  async function pixelateImages(payload) {
    const tasks = [];
    const walk = (d) => {
      if (!d) return;
      if (d.photosData) {
        d.photosData.forEach((u, i) => tasks.push(XS.pixelateDataUrl(u).then((p) => { d.photosData[i] = p; })));
      }
      if (d.videoPosterData) tasks.push(XS.pixelateDataUrl(d.videoPosterData).then((p) => { d.videoPosterData = p; }));
      if (d.quote) walk(d.quote);
    };
    walk(payload.main);
    payload.replies.forEach(walk);
    await Promise.all(tasks);
  }

  // 收集需要翻译的文本（主推文 + 引用 + 评论），一次 API 调用批量翻
  async function translateAll(main, replies) {
    const jobs = [];
    const collect = (d) => {
      if (!d) return;
      if (d.plainText && !d.translation && XS.needsTranslation(d.plainText)) jobs.push(d);
      if (d.quote) collect(d.quote);
    };
    collect(main);
    replies.forEach(collect);
    if (!jobs.length) return null;

    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'translate', texts: jobs.map((j) => j.plainText) });
    } catch (e) {
      return '翻译服务不可用：' + ((e && e.message) || e);
    }
    if (!resp || resp.error) {
      if (resp && resp.error === 'NO_KEY') return '未配置 DeepSeek API Key，已生成未翻译版本';
      return '翻译失败：' + ((resp && resp.error) || '未知错误');
    }
    jobs.forEach((j, i) => {
      if (resp.translations[i]) j.translation = resp.translations[i];
    });
    return null;
  }

  async function inlineImages(d) {
    if (!d || d.__inlined) return;
    const tasks = [];
    if (d.avatar) tasks.push(fetchDataUrl(d.avatar).then((u) => { d.avatarData = u; }));
    const photosData = [];
    (d.photos || []).slice(0, 4).forEach((p, i) => {
      tasks.push(fetchDataUrl(p).then((u) => { if (u) photosData[i] = u; }));
    });
    if (d.videoPoster) tasks.push(fetchDataUrl(d.videoPoster).then((u) => { d.videoPosterData = u; }));
    if (d.quote) tasks.push(inlineImages(d.quote));
    await Promise.all(tasks);
    d.photosData = photosData.filter(Boolean);
    d.__inlined = true;
  }

  async function fetchDataUrl(url) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'fetchImage', url });
      return (resp && resp.dataUrl) || null;
    } catch (_) {
      return null;
    }
  }

  // ---------- 预览弹窗 ----------

  // 返回 { panel, foot, setStatus }；close 按钮触发 onClose 后统一收尾
  function makeModal(title, onClose) {
    modal = document.createElement('div');
    modal.className = 'xs-modal';
    const panel = document.createElement('div');
    panel.className = 'panel';

    const head = document.createElement('div');
    head.className = 'ph';
    head.appendChild(document.createTextNode(title));
    const close = document.createElement('button');
    close.className = 'xs-btn sec';
    close.textContent = '关闭';
    close.addEventListener('click', () => {
      if (onClose) onClose();
      if (modal) { modal.remove(); modal = null; }
      state.generating = false;
      exitSelection();
    });
    head.appendChild(close);
    panel.appendChild(head);

    const foot = document.createElement('div');
    foot.className = 'pf';
    const status = document.createElement('span');
    status.className = 'status';

    modal.appendChild(panel);
    document.body.appendChild(modal);
    return {
      panel, foot, status,
      setStatus: (t) => { status.textContent = t || ''; },
      addFoot: () => { foot.appendChild(status); panel.appendChild(foot); },
    };
  }

  function btn(cls, text, onClick) {
    const b = document.createElement('button');
    b.className = 'xs-btn ' + cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function showImagePreview(blob, note) {
    const objUrl = URL.createObjectURL(blob);
    const m = makeModal('转发长图已生成', () => URL.revokeObjectURL(objUrl));

    const imWrap = document.createElement('div');
    imWrap.className = 'pim';
    const img = document.createElement('img');
    img.src = objUrl;
    imWrap.appendChild(img);
    m.panel.appendChild(imWrap);

    m.foot.appendChild(btn('pri', '复制图片', async () => {
      const ok = await copyBlob(blob);
      m.setStatus(ok ? '已复制，去微信里粘贴即可 ✓' : '复制失败，请用「下载 PNG」');
    }));
    m.foot.appendChild(btn('sec', '下载 PNG', () => {
      downloadUrl(objUrl, `x-card-${state.mainId || 'tweet'}.png`);
      m.setStatus('已下载 ✓');
    }));
    m.addFoot();
    if (note) m.setStatus(note);

    // 尝试自动复制（可能因失去用户手势而失败，失败就靠按钮）
    copyBlob(blob).then((ok) => { if (ok && !note) m.setStatus('已自动复制，去微信里粘贴即可 ✓'); });
  }

  function showWebpagePreview(html, note) {
    const objUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const m = makeModal('转发网页已生成', () => URL.revokeObjectURL(objUrl));

    const info = document.createElement('div');
    info.className = 'pweb';
    const kb = Math.round(html.length / 1024);
    info.innerHTML =
      `<p>已生成一个自包含网页（${kb} KB，含内联图片，可离线打开）。</p>` +
      `<p class="hint">发给微信好友时：若配置了发布后端可「发布并复制链接」；也可「下载 HTML」自行托管。` +
      `注意 GitHub/多数境外托管在中国大陆可能打不开，境内可访问需自建香港服务器（见 README）。</p>`;
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
      downloadUrl(objUrl, `x-tweet-${state.mainId || 'page'}.html`);
      m.setStatus('已下载 ✓');
    }));

    if (state.cfg.publishTarget !== 'none') {
      const label = state.cfg.publishTarget === 'gist' ? '发布到 Gist 并复制链接' : '发布并复制链接';
      const pub = btn('pri', label, async () => {
        if (!state.cfg.publishConfigured) { m.setStatus('发布后端未配置好，请到设置页填写'); return; }
        pub.disabled = true;
        m.setStatus('发布中…');
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'publish', html });
          if (resp && resp.url) {
            const ok = await copyText(resp.url);
            m.setStatus((ok ? '链接已复制 ✓ ' : '') + resp.url);
          } else {
            m.setStatus('发布失败：' + ((resp && resp.error) || '未知错误'));
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

  function downloadUrl(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }

  async function copyBlob(blob) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ---------- 小组件 ----------

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
    document.body.appendChild(overlay);
  }

  function setOverlay(text) {
    if (overlayText) overlayText.textContent = text;
  }

  function hideOverlay() {
    if (overlay) { overlay.remove(); overlay = null; overlayText = null; }
  }

  let toastTimer = null;
  function toast(text) {
    let t = document.querySelector('.xs-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'xs-toast';
      document.body.appendChild(t);
    }
    t.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 2600);
  }

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }
})();
