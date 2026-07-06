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
      autoHotDefault: true, autoHotN: 10,
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
            autoHotDefault: c.autoHotDefault !== false,
            autoHotN: c.autoHotN || 10,
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
    // X 长文(Article)现在由 extract.js 的兜底逻辑正确解析正文，
    // 不再需要在此处拦截（旧版本会直接拒绝，导致长文完全无法使用）。
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

    if (state.cfg.autoHotDefault) {
      autoSelectHot(); // 默认进入即自动按热度选取，之后仍可手动增减
    } else {
      toast('点击评论勾选，或用「🔥 自动选热门」一键筛选');
    }
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
    barAutoN.value = String(state.cfg.autoHotN || DEFAULT_AUTO_N);
    barAutoN.title = '自动选取的条数';
    barAutoN.addEventListener('change', () => {
      const n = clamp(parseInt(barAutoN.value, 10) || DEFAULT_AUTO_N, 1, MAX_REPLIES);
      barAutoN.value = String(n);
      state.cfg.autoHotN = n;
      chrome.storage.local.set({ autoHotN: n }); // 记住条数，下次沿用
    });
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

    const isModel = state.cfg.redactMode === 'model';
    barRedact = mkCheck(
      `敏感打码（${isModel ? '模型' : '规则'}）`,
      state.cfg.redactEnabled,
      false,
      isModel
        ? '用模型(LLM)识别并屏蔽敏感文字；可在设置里改为规则模式'
        : '按设置里的屏蔽词表(正则)屏蔽敏感文字；未填词表则不会改动内容。可在设置里改为模型模式'
    );
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
    // 收尾（解锁 / 重挂 observer / 关遮罩）必须在 finally 里，
    // 否则收割中任一处抛错会让 generating 卡死、遮罩不消、整个选择模式冻结。
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

      const ranked = [...harvest.values()].sort(
        (a, b) => (b.engagement ? b.engagement.score : 0) - (a.engagement ? a.engagement.score : 0)
      );
      state.selected.clear();
      ranked.slice(0, N).forEach((d) => state.selected.set(d.id, d));
      if (!harvest.size) toast('没抓到评论，可能页面还没加载出回复');
      else toast(`已按热度自动选中 ${state.selected.size} 条，可继续手动增减`);
    } catch (e) {
      toast('自动选热门失败：' + ((e && e.message) || e));
    } finally {
      window.scrollTo(0, startY);
      state.generating = false;
      attachObserver();
      decorateArticles();
      updateBar();
      hideOverlay();
    }
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
      const rich = XS.buildRichHtml(payload);
      const plain = XS.buildPlainText(payload);
      hideOverlay();
      showWebpagePreview(html, rich, plain, payload.note);
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
      if (state.cfg.redactMode === 'model') {
        const err = await redactModel(clone);
        redactNote = err || '已用模型打码（DeepSeek 识别）';
      } else {
        redactNote = redactRules(clone).note;
      }
      if (state.cfg.redactImages) {
        await pixelateImages(clone);
        redactNote = joinNotes(redactNote, '图片已打码');
      }
    }
    clone.redactNote = redactNote;
    return clone;
  }

  // 返回 { note }：让用户看得见「打了几处 / 为何没效果」，而不是静默无操作
  function redactRules(payload) {
    const terms = XS.compileRedactTerms(state.cfg.redactTerms, state.cfg.redactPII);
    if (!terms.length) {
      return { note: '⚠️ 已开「规则打码」但未配置屏蔽词/PII，未改动任何内容（去设置页填词表）' };
    }
    let hits = 0;
    const one = (str) => { const r = XS.redactTextCount(str, terms); hits += r.hits; return r.text; };
    const maskSegs = (segs) => segs.map((s) => ({ type: s.type, text: one(s.text) }));
    const walk = (d) => {
      if (!d) return;
      // 渲染走 blocks，所以按块打码；再从打码后的块回填 d.segments（供纯文本/富文本兜底，且只计一次数）
      if (d.blocks && d.blocks.length) {
        d.blocks = d.blocks.map((b) => (b.type === 'text' ? { type: 'text', segments: maskSegs(b.segments) } : b));
        const agg = [];
        for (const b of d.blocks) if (b.type === 'text') for (const s of b.segments) agg.push(s);
        d.segments = agg;
      } else if (d.segments) {
        d.segments = maskSegs(d.segments);
      }
      if (d.translation) d.translation = one(d.translation);
      if (d.quote) walk(d.quote);
    };
    walk(payload.main);
    payload.replies.forEach(walk);
    return { note: hits ? `已按规则打码 ${hits} 处` : '规则打码：本次内容未命中屏蔽词' };
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
      if (it.kind === 'orig') {
        it.d.segments = [{ type: 'text', text: r }];
        // 同步有序块：把打码后的整段放进第一个文本块，其余文本块清空（媒体/引用块保持原位）
        if (it.d.blocks && it.d.blocks.length) {
          let placed = false;
          it.d.blocks = it.d.blocks.map((b) => {
            if (b.type !== 'text') return b;
            if (!placed) { placed = true; return { type: 'text', segments: [{ type: 'text', text: r }] }; }
            return { type: 'text', segments: [] };
          });
          if (!placed) it.d.blocks.unshift({ type: 'text', segments: [{ type: 'text', text: r }] });
        }
      } else it.d.translation = r;
    });
    return null;
  }

  async function pixelateImages(payload) {
    const tasks = [];
    const walk = (d) => {
      if (!d) return;
      if (d.photosData) {
        d.photosData.forEach((u, i) => { if (u) tasks.push(XS.pixelateDataUrl(u).then((p) => { d.photosData[i] = p; })); });
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
    // 头像：先试升级后的 _200x200，失败回退原始 DOM 尺寸（修复头像不显示）
    const avaUrls = [d.avatar, d.avatarSrc].filter(Boolean);
    if (avaUrls.length) tasks.push(fetchFirstDataUrl(avaUrls).then((u) => { d.avatarData = u; }));
    // photosData 必须与 photos 同下标对齐（失败填 null）——有序块按 idx 取图，不能压缩
    const photos = (d.photos || []).slice(0, 4);
    const photosData = new Array(photos.length).fill(null);
    photos.forEach((p, i) => {
      tasks.push(fetchDataUrl(p).then((u) => { photosData[i] = u || null; }));
    });
    if (d.videoPoster) tasks.push(fetchDataUrl(d.videoPoster).then((u) => { d.videoPosterData = u; }));
    if (d.quote) tasks.push(inlineImages(d.quote));
    await Promise.all(tasks);
    d.photosData = photosData;
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

  // 依次尝试多个候选 URL，返回第一个成功的 data URL（头像升级变体失效时兜底）
  async function fetchFirstDataUrl(urls) {
    for (const u of urls) {
      const data = await fetchDataUrl(u);
      if (data) return data;
    }
    return null;
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

  function showWebpagePreview(html, rich, plain, note) {
    const objUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const m = makeModal('转发网页已生成', () => URL.revokeObjectURL(objUrl));

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
      downloadUrl(objUrl, `x-tweet-${state.mainId || 'page'}.html`);
      m.setStatus('已下载 ✓');
    }));

    m.foot.appendChild(btn('pri', '复制图文', async () => {
      const ok = await copyRich(rich, plain);
      m.setStatus(ok
        ? '图文已复制 ✓ 去公众号/语雀/飞书/腾讯文档/印象笔记粘贴，由平台生成链接'
        : '复制失败，请改用「下载 HTML」');
    }));

    // 发布到腾讯文档（引导式半自动）：无条件显示，不依赖 publishTarget 配置。
    // 主通道是系统剪贴板——这里在用户手势内用 copyRich 把图文写入剪贴板，再存 pending
    // 任务、开 docs.qq.com/desktop 新标签，由 txdocs.js 挂引导浮层、按状态机推进。
    m.foot.appendChild(btn('pri2', '发布到腾讯文档', async () => {
      const ok = await copyRich(rich, plain);
      if (!ok) { m.setStatus('复制失败，无法发布到腾讯文档（图文需先进剪贴板）'); return; }
      try {
        await chrome.storage.local.set({
          xsTxdocsPending: {
            html: rich,
            plain: plain || '',
            title: txdocsTitle(state.mainData),
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

    if (state.cfg.publishTarget !== 'none') {
      const label = state.cfg.publishTarget === 'gist' ? '发布到 Gist 并复制链接'
        : state.cfg.publishTarget === 'cloudbase' ? '发布到 CloudBase 并复制链接'
        : '发布并复制链接';
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
    } catch (_) {
      return false;
    }
  }

  // 腾讯文档 pending 任务的标题：作者名 + 正文摘要，截断到 ~40 字（供引导浮层展示）。
  function txdocsTitle(main) {
    if (!main) return '推文转发';
    const name = main.name || main.handle || '';
    const text = main.plainText ||
      (main.segments ? main.segments.map((s) => s.text).join('') : '');
    const n = String(name).trim();
    const t = String(text).trim().replace(/\s+/g, ' ');
    let s = n && t ? `${n}：${t}` : (n || t) || '推文转发';
    if (s.length > 40) s = s.slice(0, 39) + '…';
    return s;
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
