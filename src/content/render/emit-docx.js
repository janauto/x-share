// 发射器：RenderIR → OOXML document.xml（Word .docx 的主文档部件，两栖模块）。
//
// 纯字符串拼装、无 DOM，node 可直接单测。打包成 .docx 交给 zipdocx.docxFromXml：
// 本模块只产出 { documentXml, media }，media[i]（0 基）在 documentXml 里用
// r:embed="rIdImg{i+1}"（1 基）引用——与 zipdocx 的 rId 约定一致。
//
// 内容层级与 emit-rich 的扁平语义一致（名字行 / 正文 / 译文 / 图 / 引用 / 评论区 / 落款），
// 语义已由 shared/ir.js 解决，这里只对 node.kind 做哑 switch。
//
// 注意转义：XML 与 HTML 的转义集不同（XML 属性里单引号也危险），
// 这里用独立的 escXml（& < > " ' 五件套），不要复用 XS.esc（它不转义单引号）。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  // node 里 require 兄弟模块（它们都挂到同一个 globalThis.__XS）；浏览器/SW 里靠加载顺序。
  if ((!XS.buildIR || !XS.fmtDate) && typeof require !== 'undefined') {
    try {
      require('../../shared/fmt.js');
      require('../../shared/ir.js'); // ir 自带 blocks 兜底
    } catch (_) { /* 浏览器环境走已加载的 XS */ }
  }

  // ---- 常量 ----
  const EMU_PER_PX = 9525;      // 96dpi 下 1px = 9525 EMU
  const MAX_CX = 6000000;       // 可用内容宽（A4 - 2cm*2 页边距 ≈ 15.7cm）
  const DEFAULT_DIMS = { w: 1200, h: 675 }; // photoDims 缺失时按 16:9 假定
  const A4 = { w: 11906, h: 16838 };        // twips
  const MARGIN = 1134;                      // 2cm = 1134 twips
  const GRAY = '536471';        // 次要文字（@handle / 小标题）
  const GRAY_LIGHT = '8B98A5';  // 落款
  const BLUE = '1D9BF0';        // 实体 / 译文
  const BORDER = 'CFD9DE';      // 引用左边框 / 分隔线
  const SZ_BODY = 22;           // 半点：15px ≈ 11pt = 22 半点
  const SZ_SMALL = 18;          // 半点：12px ≈ 9pt = 18 半点

  // XML 转义五件套（文本与属性通用）。独立实现，勿换成 XS.esc。
  function escXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ---- run / 段落原语 ----

  // 文本 → <w:t>，段内 \n → <w:br/>（同一 run 内交替）。
  function wText(text) {
    return String(text == null ? '' : text)
      .split('\n')
      .map((part) => (part ? `<w:t xml:space="preserve">${escXml(part)}</w:t>` : ''))
      .join('<w:br/>');
  }

  // rpr 是 <w:rPr> 内的属性串（可空）。
  function run(text, rpr) {
    return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}${wText(text)}</w:r>`;
  }

  function rprOf({ bold, color, sz } = {}) {
    let p = '';
    if (bold) p += '<w:b/>';
    if (color) p += `<w:color w:val="${color}"/>`;
    const size = sz || SZ_BODY;
    p += `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
    return p;
  }

  // ppr 是 <w:pPr> 内的属性串（可空）；runs 是已拼好的 run 串（可空 = 空段）。
  function para(runs, ppr) {
    return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs || ''}</w:p>`;
  }

  // 引用装饰：左缩进 + 左边框（pPr 内 pBdr 须在 ind 之前，schema 顺序）。
  const QUOTE_PPR =
    `<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="${BORDER}"/></w:pBdr>` +
    '<w:ind w:left="480"/>';

  // 分隔线：带下边框的空段（评论区分隔 / 评论之间）。
  const SEP_PPR =
    `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${BORDER}"/></w:pBdr>`;

  // ---- 图片 ----

  // 像素 → EMU，超可用宽等比缩到 MAX_CX。
  function emuSize(dims) {
    const w = dims && Number(dims.w) > 0 ? Number(dims.w) : DEFAULT_DIMS.w;
    const h = dims && Number(dims.h) > 0 ? Number(dims.h) : DEFAULT_DIMS.h;
    let cx = Math.round(w * EMU_PER_PX);
    let cy = Math.round(h * EMU_PER_PX);
    if (cx > MAX_CX) {
      cy = Math.round((cy * MAX_CX) / cx);
      cx = MAX_CX;
    }
    return { cx, cy };
  }

  // data URL → contentType / 扩展名（假 data URL 或识别失败时按 png 兜底）。
  function sniffContentType(dataUrl) {
    const m = /^data:(image\/[a-z0-9.+-]+)[;,]/i.exec(String(dataUrl || ''));
    const contentType = m ? m[1].toLowerCase() : 'image/png';
    const ext = contentType.split('/')[1].replace(/[^a-z0-9]/g, '') || 'png';
    return { contentType, ext };
  }

  // <w:drawing> 完整链（wp:inline → a:graphic → pic:pic → a:blip r:embed）。
  // rIdImg 的序号 = media 下标 + 1；docPr/cNvPr 的 id 也用它（全文唯一即可）。
  function drawingXml(rIdNum, name, cx, cy) {
    return (
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${rIdNum}" name="${escXml(name)}"/>` +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic>' +
      `<pic:nvPicPr><pic:cNvPr id="${rIdNum}" name="${escXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rIdImg${rIdNum}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/>' +
      `<a:ext cx="${cx}" cy="${cy}"/>` +
      '</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
    );
  }

  // ---- 主构建 ----

  // payload → { documentXml, media }
  //   media: [{ name: 'image1.png', dataUrl, contentType }...]，documentXml 里
  //   r:embed="rIdImg1" 对应 media[0]，以此类推。
  function buildDocxParts(payload) {
    const { main, replies } = payload;
    const media = [];

    // 登记一张图，返回其图片段落 XML。dims 为像素尺寸（可缺）。
    function imgPara(dataUrl, dims, ppr) {
      const { contentType, ext } = sniffContentType(dataUrl);
      const name = `image${media.length + 1}.${ext}`;
      media.push({ name, dataUrl, contentType });
      const { cx, cy } = emuSize(dims);
      return para(`<w:r>${drawingXml(media.length, name, cx, cy)}</w:r>`, ppr);
    }

    // 名字行：加粗名字 + 灰色 @handle；withEng 时（评论有热度分）末尾补灰色小字。
    function nameLinePara(d, ppr, withEng) {
      let runs =
        run(d.name || '', rprOf({ bold: true })) +
        run(` ${d.handle || ''}`, rprOf({ color: GRAY }));
      if (withEng && d.engagement && d.engagement.score) {
        runs += run(
          ` · 赞${d.engagement.likes} 转${d.engagement.retweets}`,
          rprOf({ color: GRAY, sz: SZ_SMALL })
        );
      }
      return para(runs, ppr);
    }

    // 正文文本块：实体蓝色，普通文本默认色，同段拼 run。
    function textPara(segments, ppr) {
      const runs = (segments || [])
        .map((s) => run(s.text, s.type === 'ent' ? rprOf({ color: BLUE }) : rprOf()))
        .join('');
      return para(runs, ppr);
    }

    // 一条推文（含引用递归）→ 段落串。ppr 非空时=在引用里，所有段落带引用装饰。
    function tweetParas(d, ppr, withEng) {
      let xml = nameLinePara(d, ppr, withEng);
      for (const node of XS.buildIR(d)) {
        if (node.kind === 'text') {
          xml += textPara(node.segments, ppr);
        } else if (node.kind === 'translation') {
          xml += para(run(`【译】${node.text}`, rprOf({ color: BLUE })), ppr);
        } else if (node.kind === 'photos') {
          for (const u of node.urls) {
            // 像素尺寸取原图位下标对应的 d.photoDims[i]（urls 已过滤失败位，
            // 用 photosData 反查原下标；缺失按 DEFAULT_DIMS）。
            const i = (d.photosData || []).indexOf(u);
            const dims = (d.photoDims && i >= 0 && d.photoDims[i]) || null;
            xml += imgPara(u, dims, ppr);
          }
        } else if (node.kind === 'video') {
          // 封面像素尺寸由 pipeline.inlineImages 补采集（d.videoPosterDims，可缺）。
          if (node.poster) xml += imgPara(node.poster, d.videoPosterDims || null, ppr);
          xml += para(
            run('视频内容 · 请打开原文链接观看', rprOf({ color: GRAY, sz: SZ_SMALL })),
            ppr
          );
        } else if (node.kind === 'quote') {
          xml += tweetParas(node.tweet, QUOTE_PPR, false);
        }
      }
      return xml;
    }

    let body = tweetParas(main, '', false);

    if (replies && replies.length) {
      body += para('', SEP_PPR); // 分隔线
      body += para(run(`精选评论 · ${replies.length} 条`, rprOf({ color: GRAY, sz: SZ_SMALL })));
      replies.forEach((r, i) => {
        if (i > 0) body += para('', SEP_PPR);
        body += tweetParas(r, '', true);
      });
    }

    // 落款：时间 · 原文：链接（灰色小字）。
    const t = XS.fmtDate(main.datetime);
    const link = main.permalink ? `原文：${main.permalink}` : '';
    body += para(run(`${t ? `${t} · ` : ''}${link}`, rprOf({ color: GRAY_LIGHT, sz: SZ_SMALL })));

    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document' +
      ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
      ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
      ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<w:body>${body}` +
      '<w:sectPr>' +
      `<w:pgSz w:w="${A4.w}" w:h="${A4.h}"/>` +
      `<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="708" w:footer="708" w:gutter="0"/>` +
      '</w:sectPr>' +
      '</w:body></w:document>';

    return { documentXml, media };
  }

  XS.buildDocxParts = buildDocxParts;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildDocxParts };
  }
})();
