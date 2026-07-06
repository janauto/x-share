// 主流程：悬浮按钮 → 评论勾选模式 → 抓图/翻译 → 长图预览。
// 注意：X 的时间线是虚拟滚动，回复滚出视野后 DOM 会被回收，
// 所以勾选的瞬间就要把数据提取缓存下来（state.selected 存的是数据不是元素）。

(() => {
  if (window.__XS_CONTENT_LOADED) return;
  window.__XS_CONTENT_LOADED = true;

  const XS = window.__XS;
  const MAX_REPLIES = 12;

  const state = {
    selecting: false,
    generating: false,
    mainData: null,
    mainId: null,
    selected: new Map(), // id -> tweetData（勾选时立即提取）
    hasKey: false,
    translateDefault: true,
  };

  let fab, bar, barCount, barTrans, overlay, overlayText, modal, observer;

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
        }
      })
      .catch(() => {});
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

    observer = new MutationObserver(debounce(decorateArticles, 300));
    observer.observe(document.body, { childList: true, subtree: true });

    toast('点击下方评论可勾选，最多 ' + MAX_REPLIES + ' 条');
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
    bar.appendChild(barCount);

    const label = document.createElement('label');
    barTrans = document.createElement('input');
    barTrans.type = 'checkbox';
    barTrans.checked = state.hasKey && state.translateDefault;
    if (!state.hasKey) {
      barTrans.disabled = true;
      label.title = '先点扩展图标打开设置，填入 DeepSeek API Key';
    }
    label.appendChild(barTrans);
    label.appendChild(document.createTextNode(state.hasKey ? '附中文翻译' : '附中文翻译（未配置 Key）'));
    bar.appendChild(label);

    const gen = document.createElement('button');
    gen.className = 'xs-btn pri';
    gen.textContent = '生成长图';
    gen.addEventListener('click', generate);
    bar.appendChild(gen);

    const cancel = document.createElement('button');
    cancel.className = 'xs-btn sec';
    cancel.textContent = '取消';
    cancel.addEventListener('click', exitSelection);
    bar.appendChild(cancel);

    document.body.appendChild(bar);
    updateBar();
  }

  function updateBar() {
    if (barCount) barCount.textContent = `已选 ${state.selected.size} 条评论`;
  }

  // ---------- 生成流程 ----------

  async function generate() {
    if (state.generating) return;
    state.generating = true;
    showOverlay('提取内容…');

    try {
      const main = state.mainData;
      const replies = [...state.selected.values()];

      setOverlay('转存图片…');
      await Promise.all([inlineImages(main), ...replies.map(inlineImages)]);

      let transError = null;
      if (barTrans && barTrans.checked) {
        setOverlay('翻译中…');
        transError = await translateAll(main, replies);
      }

      setOverlay('渲染长图…');
      const card = XS.buildCard({ main, replies });
      const blob = await XS.renderCardToPng(card);

      hideOverlay();
      showPreview(blob, transError);
    } catch (e) {
      hideOverlay();
      state.generating = false;
      toast('生成失败：' + ((e && e.message) || e));
    }
  }

  // 收集需要翻译的文本（主推文 + 引用 + 评论），一次 API 调用批量翻
  async function translateAll(main, replies) {
    const jobs = [];
    const collect = (d) => {
      if (!d) return;
      if (d.plainText && XS.needsTranslation(d.plainText)) jobs.push(d);
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
    if (!d) return;
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

  function showPreview(blob, transError) {
    const objUrl = URL.createObjectURL(blob);

    modal = document.createElement('div');
    modal.className = 'xs-modal';

    const panel = document.createElement('div');
    panel.className = 'panel';

    const head = document.createElement('div');
    head.className = 'ph';
    head.appendChild(document.createTextNode('转发卡片已生成'));
    const close = document.createElement('button');
    close.className = 'xs-btn sec';
    close.textContent = '关闭';
    close.addEventListener('click', closePreview);
    head.appendChild(close);
    panel.appendChild(head);

    const imWrap = document.createElement('div');
    imWrap.className = 'pim';
    const img = document.createElement('img');
    img.src = objUrl;
    imWrap.appendChild(img);
    panel.appendChild(imWrap);

    const foot = document.createElement('div');
    foot.className = 'pf';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'xs-btn pri';
    copyBtn.textContent = '复制图片';
    foot.appendChild(copyBtn);

    const dlBtn = document.createElement('button');
    dlBtn.className = 'xs-btn sec';
    dlBtn.textContent = '下载 PNG';
    foot.appendChild(dlBtn);

    const status = document.createElement('span');
    status.className = 'status';
    foot.appendChild(status);
    panel.appendChild(foot);

    modal.appendChild(panel);
    document.body.appendChild(modal);

    const setStatus = (t) => { status.textContent = t; };
    if (transError) setStatus(transError);

    copyBtn.addEventListener('click', async () => {
      const ok = await copyBlob(blob);
      setStatus(ok ? '已复制，去微信里粘贴即可 ✓' : '复制失败，请用「下载 PNG」');
    });

    dlBtn.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `x-card-${state.mainId || 'tweet'}.png`;
      a.click();
      setStatus('已下载 ✓');
    });

    // 尝试自动复制（可能因失去用户手势而失败，失败就靠按钮）
    copyBlob(blob).then((ok) => {
      if (ok && !transError) setStatus('已自动复制，去微信里粘贴即可 ✓');
    });

    function closePreview() {
      URL.revokeObjectURL(objUrl);
      modal.remove();
      modal = null;
      state.generating = false;
      exitSelection();
    }
  }

  async function copyBlob(blob) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
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
