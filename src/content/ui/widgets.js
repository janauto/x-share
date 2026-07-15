// 页面内 UI 组件（视图层）：fab / 操作栏 / 弹窗 / 遮罩 / toast / 预览，及 mkCheck / btn。
// 全部走 CSSOM（className + content.css，或逐属性），不在 x.com 页内注入 <style>。
//
// 从原 content.js 拆出的「哑视图」：只负责构造 DOM 与暴露交互回调，
// 状态与事件编排留在 content.js。挂在 XS.ui.* 命名空间。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});
  const MAX = 20;

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // ---------- fab ----------
  function makeFab(onClick) {
    const fab = document.createElement('button');
    fab.className = 'xs-fab';
    fab.textContent = '📤 生成转发卡片';
    fab.addEventListener('click', onClick);
    return fab;
  }

  // ---------- mkCheck / btn ----------
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

  function btn(cls, text, onClick) {
    const b = document.createElement('button');
    b.className = 'xs-btn ' + cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------- 底部操作栏 ----------
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

    // 自动选热门：数量输入 + 按钮
    const autoWrap = document.createElement('span');
    autoWrap.className = 'xs-autowrap';
    const autoBtn = document.createElement('button');
    autoBtn.className = 'xs-btn sec';
    autoBtn.textContent = '🔥 自动选热门';
    autoBtn.title = '滚动评论区、按热度自动选出前 N 条，之后仍可手动增减';
    autoBtn.addEventListener('click', opts.onAuto);
    autoWrap.appendChild(autoBtn);
    const barAutoN = document.createElement('input');
    barAutoN.type = 'number';
    barAutoN.className = 'xs-num';
    barAutoN.min = '1';
    barAutoN.max = String(maxReplies);
    barAutoN.value = String(opts.autoHotN || defaultAutoN);
    barAutoN.title = '自动选取的条数';
    barAutoN.addEventListener('change', () => {
      const n = clamp(parseInt(barAutoN.value, 10) || defaultAutoN, 1, maxReplies);
      barAutoN.value = String(n);
      opts.onAutoNChange && opts.onAutoNChange(n); // 记住条数，下次沿用
    });
    autoWrap.appendChild(barAutoN);
    autoWrap.appendChild(document.createTextNode('条'));
    bar.appendChild(autoWrap);

    const barTrans = mkCheck(
      opts.hasKey ? '附中文翻译' : '附中文翻译（未配置 Key）',
      opts.hasKey && opts.translateDefault,
      !opts.hasKey,
      !opts.hasKey ? '先点扩展图标打开设置，填入 DeepSeek API Key' : ''
    );
    bar.appendChild(barTrans.label);

    const isModel = opts.redactMode === 'model';
    const barRedact = mkCheck(
      `敏感打码（${isModel ? '模型' : '规则'}）`,
      opts.redactEnabled,
      false,
      isModel
        ? '用模型(LLM)识别并屏蔽敏感文字；可在设置里改为规则模式'
        : '按设置里的屏蔽词表(正则)屏蔽敏感文字；未填词表则不会改动内容。可在设置里改为模型模式'
    );
    bar.appendChild(barRedact.label);

    const genImg = document.createElement('button');
    genImg.className = 'xs-btn pri';
    genImg.textContent = '生成长图';
    genImg.addEventListener('click', opts.onGenImage);
    bar.appendChild(genImg);

    const genWeb = document.createElement('button');
    genWeb.className = 'xs-btn pri2';
    genWeb.textContent = '生成网页';
    genWeb.addEventListener('click', opts.onGenWeb);
    bar.appendChild(genWeb);

    const cancel = document.createElement('button');
    cancel.className = 'xs-btn sec';
    cancel.textContent = '取消';
    cancel.addEventListener('click', opts.onCancel);
    bar.appendChild(cancel);

    return {
      el: bar,
      setCount: (n) => { barCount.textContent = `已选 ${n} 条`; },
      isTranslate: () => barTrans.input.checked,
      isRedact: () => barRedact.input.checked,
      autoN: () => clamp(parseInt(barAutoN.value, 10) || defaultAutoN, 1, maxReplies),
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
    document.body.appendChild(overlay);
  }
  function setOverlay(text) { if (overlayText) overlayText.textContent = text; }
  function hideOverlay() { if (overlay) { overlay.remove(); overlay = null; overlayText = null; } }

  // ---------- toast ----------
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

  // ---------- 弹窗骨架 ----------
  // 返回 { el, panel, foot, status, setStatus, addFoot, destroy }；
  // 关闭按钮触发 onClose（由调用方决定收尾：撤销 objectURL、销毁弹窗、复位状态）。
  function makeModal(title, onClose) {
    const modal = document.createElement('div');
    modal.className = 'xs-modal';
    const panel = document.createElement('div');
    panel.className = 'panel';

    const head = document.createElement('div');
    head.className = 'ph';
    head.appendChild(document.createTextNode(title));
    const close = document.createElement('button');
    close.className = 'xs-btn sec';
    close.textContent = '关闭';
    close.addEventListener('click', () => { if (onClose) onClose(); });
    head.appendChild(close);
    panel.appendChild(head);

    const foot = document.createElement('div');
    foot.className = 'pf';
    const status = document.createElement('span');
    status.className = 'status';

    modal.appendChild(panel);
    document.body.appendChild(modal);
    return {
      el: modal, panel, foot, status,
      setStatus: (t) => { status.textContent = t || ''; },
      addFoot: () => { foot.appendChild(status); panel.appendChild(foot); },
      destroy: () => modal.remove(),
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

  // ---------- 长图预览 ----------
  // opts: { mainId, onClose }（onClose 做编排收尾：复位 generating、退出选择模式）
  function showImagePreview(blob, note, opts) {
    const objUrl = URL.createObjectURL(blob);
    const m = makeModal('转发长图已生成', () => {
      URL.revokeObjectURL(objUrl);
      m.destroy();
      opts.onClose && opts.onClose();
    });

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
      downloadUrl(objUrl, `x-card-${(opts && opts.mainId) || 'tweet'}.png`);
      m.setStatus('已下载 ✓');
    }));
    m.addFoot();
    if (note) m.setStatus(note);

    // 尝试自动复制（可能因失去用户手势而失败，失败就靠按钮）
    copyBlob(blob).then((ok) => { if (ok && !note) m.setStatus('已自动复制，去微信里粘贴即可 ✓'); });
  }

  // ---------- 网页预览 ----------
  // opts: { mainData, mainId, cfg, onClose }
  function showWebpagePreview(html, rich, plain, note, opts) {
    const cfg = opts.cfg || {};
    const objUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const m = makeModal('转发网页已生成', () => {
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
      m.setStatus('已下载 ✓');
    }));

    m.foot.appendChild(btn('pri', '复制图文', async () => {
      const ok = await copyRich(rich, plain);
      m.setStatus(ok
        ? '图文已复制 ✓ 去公众号/语雀/飞书/腾讯文档/印象笔记粘贴，由平台生成链接'
        : '复制失败，请改用「下载 HTML」');
    }));

    // 发布到腾讯文档（引导式半自动）：无条件显示，不依赖 publishTarget 配置。
    // 主通道是系统剪贴板——在用户手势内用 copyRich 把图文写入剪贴板，再存 pending
    // 任务、开 docs.qq.com/desktop 新标签，由 txdocs.js 挂引导浮层、按状态机推进。
    m.foot.appendChild(btn('pri2', '发布到腾讯文档', async () => {
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
            m.setStatus((okCopy ? '链接已复制 ✓ ' : '') + r.url);
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
    makeFab,
    mkCheck,
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
    showImagePreview,
    showWebpagePreview,
  };
})();
