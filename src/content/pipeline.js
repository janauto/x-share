// 生成管线：抓图（内联）→ 翻译 → 打码克隆。纯数据进出（无 UI），经 rpc 走后台。
// 从原 content.js 的 runGenerate 内脏形式化而来。挂 XS.pipeline.*。
//
// 抓图改用批量 rpc.fetchImages：每条推文把「头像候选 + 图片 + 视频封面」合成一条消息，
// 逐 URL 失败填 null，不再每张图一条消息、也不让单张失败拖垮整批。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  const joinNotes = (a, b) => [a, b].filter(Boolean).join('；') || null;

  // 批量抓图，返回与输入等长、失败位为 null 的 data URL 数组
  async function fetchImagesData(urls) {
    if (!urls.length) return [];
    const r = await XS.rpc.fetchImages(urls);
    return r && r.ok && Array.isArray(r.dataUrls) ? r.dataUrls : urls.map(() => null);
  }

  // 把一条推文（及其引用）的图片内联成 data URL。
  // 头像两个候选（升级后的 _200x200 与原始 DOM 尺寸）并行抓，取第一个成功的——
  // 结果与旧的「先试升级、失败再回退」一致，只是并行、少一轮消息。
  // photosData 必须与 photos 同下标对齐（失败填 null）——有序块按 idx 取图，不能压缩。
  async function inlineImages(d) {
    if (!d || d.__inlined) return;
    const tasks = [];
    if (d.quote) tasks.push(inlineImages(d.quote)); // 引用单独一批

    const avaUrls = [d.avatar, d.avatarSrc].filter(Boolean);
    const photos = (d.photos || []).slice(0, 4);
    const batch = [...avaUrls, ...photos];
    if (d.videoPoster) batch.push(d.videoPoster);

    const res = await fetchImagesData(batch);
    let k = 0;
    if (avaUrls.length) {
      const avaData = avaUrls.map(() => res[k++]);
      d.avatarData = avaData.find(Boolean) || null;
    }
    const photosData = new Array(photos.length).fill(null);
    for (let i = 0; i < photos.length; i++) photosData[i] = res[k++] || null;
    if (d.videoPoster) d.videoPosterData = res[k++] || null;

    await Promise.all(tasks);
    d.photosData = photosData;
    d.__inlined = true;
  }

  // 收集需要翻译的文本（主推文 + 引用 + 评论），一次 API 调用批量翻。返回错误串 | null。
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

    const r = await XS.rpc.translate(jobs.map((j) => j.plainText));
    if (!r.ok) {
      if (r.transport) return '翻译服务不可用：' + r.error;
      if (r.error === 'NO_KEY') return '未配置 DeepSeek API Key，已生成未翻译版本';
      return '翻译失败：' + (r.error || '未知错误');
    }
    jobs.forEach((j, i) => { if (r.translations[i]) j.translation = r.translations[i]; });
    return null;
  }

  // 在克隆副本上做打码，保证原始缓存不被破坏（可重复生成、切换打码开关）。
  // opts: { redact:boolean, cfg, onStage(label) }
  async function redactedClone({ main, replies }, opts) {
    const clone = structuredClone({ main, replies });
    let redactNote = null;
    if (opts.redact) {
      if (opts.onStage) opts.onStage('敏感内容处理…');
      if (opts.cfg.redactMode === 'model') {
        const err = await redactModel(clone);
        redactNote = err || '已用模型打码（DeepSeek 识别）';
      } else {
        redactNote = redactRules(clone, opts.cfg).note;
      }
      if (opts.cfg.redactImages) {
        await pixelateImages(clone);
        redactNote = joinNotes(redactNote, '图片已打码');
      }
    }
    clone.redactNote = redactNote;
    return clone;
  }

  // 返回 { note }：让用户看得见「打了几处 / 为何没效果」，而不是静默无操作
  function redactRules(payload, cfg) {
    const terms = XS.compileRedactTerms(cfg.redactTerms, cfg.redactPII);
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

    const r = await XS.rpc.redact(items.map((i) => i.text));
    if (!r.ok) {
      if (r.transport) return '模型屏蔽失败，已按未打码生成：' + r.error;
      if (r.error === 'NO_KEY') return '未配置 API Key，无法用模型屏蔽';
      return '模型屏蔽失败：' + (r.error || '未知错误');
    }
    items.forEach((it, i) => {
      const rr = r.redacted[i];
      if (rr == null) return;
      if (it.kind === 'orig') {
        it.d.segments = [{ type: 'text', text: rr }];
        // 同步有序块：把打码后的整段放进第一个文本块，其余文本块清空（媒体/引用块保持原位）
        if (it.d.blocks && it.d.blocks.length) {
          let placed = false;
          it.d.blocks = it.d.blocks.map((b) => {
            if (b.type !== 'text') return b;
            if (!placed) { placed = true; return { type: 'text', segments: [{ type: 'text', text: rr }] }; }
            return { type: 'text', segments: [] };
          });
          if (!placed) it.d.blocks.unshift({ type: 'text', segments: [{ type: 'text', text: rr }] });
        }
      } else it.d.translation = rr;
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

  XS.pipeline = { inlineImages, translateAll, redactedClone, joinNotes };
})();
