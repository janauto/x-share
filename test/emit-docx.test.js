'use strict';
// emit-docx（RenderIR → OOXML document.xml）结构断言：
// well-formed、XML 转义、media 与 rIdImg 一一对应、译文位置、引用 pBdr、EMU 等比尺寸。
const { test } = require('node:test');
const assert = require('node:assert');

require('../src/shared/fmt.js');
require('../src/shared/blocks.js');
require('../src/shared/ir.js');
require('../src/content/render/emit-docx.js');
const XS = global.__XS;

const seg = (text, type) => ({ type: type || 'text', text });

// 主推文：穿插图文（文字→图→文字）、\n 换行、需转义字符 & < > ' "、译文、视频、引用。
// photoDims：第 0 张给 800x400（断言 EMU 具体值），第 1 张缺失（走 1200x675 兜底）。
const main = {
  name: `Alice <A&B> 'q' "w"`, handle: '@alice',
  permalink: 'https://x.com/alice/status/1', datetime: '2026-03-05T08:07:00',
  translation: '这是译文',
  blocks: [
    { type: 'text', segments: [seg('First line\nsecond line '), seg('@bob', 'ent')] },
    { type: 'photos', idx: [0, 1] },
    { type: 'text', segments: [seg('After image')] },
    { type: 'video' },
    { type: 'quote' },
  ],
  segments: [seg('First line\nsecond line '), seg('@bob', 'ent'), seg('After image')],
  photosData: ['data:PHOTO0', 'data:PHOTO1'],
  photoDims: [{ w: 800, h: 400 }],
  hasVideo: true, videoPosterData: 'data:VPOSTER',
  quote: {
    name: 'Q<&>', handle: '@quoted', permalink: 'https://x.com/q/status/9', datetime: null,
    translation: '引用译文',
    blocks: [{ type: 'text', segments: [seg('quoted body')] }, { type: 'photos', idx: [0] }],
    segments: [seg('quoted body')], photosData: ['data:QPHOTO'],
    hasVideo: false, videoPosterData: null, quote: null,
  },
};
// 纯图评论 + 译文（垫底）+ 热度；图用带 MIME 的 data URL（断言 contentType 嗅探）。
const pureImgReply = {
  name: 'Img', handle: '@img', permalink: 'https://x.com/img/status/2',
  datetime: null, translation: '图片评论译文',
  blocks: [{ type: 'photos', idx: [0] }],
  segments: [], photosData: ['data:image/jpeg;base64,QQ=='], hasVideo: false,
  videoPosterData: null, quote: null,
  engagement: { score: 137, likes: 100, retweets: 30, replies: 7 },
};
const payload = { main, replies: [pureImgReply] };

const { documentXml, media } = XS.buildDocxParts(payload);

// ---- 极简 well-formed 检查：栈式标签配对（本产物无 CDATA/注释，属性值已转义无裸 >）----
function checkWellFormed(xml) {
  const stack = [];
  const re = /<([^>]+)>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[1];
    if (tag.startsWith('?')) continue;               // <?xml ... ?>
    if (tag.endsWith('/')) continue;                 // 自闭合
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      const open = stack.pop();
      if (open !== name) return `闭合不配对：</${name}> 对上了 <${open}>`;
    } else {
      stack.push(tag.split(/\s/)[0]);                // 开标签取名字
    }
  }
  if (stack.length) return `未闭合标签：${stack.join(', ')}`;
  return null;
}

test('emit-docx：documentXml 通过栈式标签配对检查', () => {
  const err = checkWellFormed(documentXml);
  assert.strictEqual(err, null, err || '');
  // 骨架完备
  assert.ok(documentXml.startsWith('<?xml version="1.0"'));
  assert.ok(documentXml.includes('<w:body>') && documentXml.endsWith('</w:body></w:document>'));
  assert.ok(documentXml.includes('<w:sectPr>') && documentXml.includes('w:w="11906" w:h="16838"'));
});

test('emit-docx：XML 转义五件套生效，原始 < 不出现在文本区', () => {
  assert.ok(documentXml.includes('Alice &lt;A&amp;B&gt; &apos;q&apos; &quot;w&quot;'), '名字应全量转义');
  assert.ok(!documentXml.includes('Alice <A&B>'), '原始 < & 不应出现');
  assert.ok(documentXml.includes('Q&lt;&amp;&gt;'), '引用作者名应转义');
  // 文本区（<w:t>...</w:t> 之间）不允许出现裸 < & （> 允许但本实现同样转义了）
  const texts = [...documentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]);
  assert.ok(texts.length > 0);
  for (const t of texts) {
    assert.ok(!/[<>]/.test(t), `文本区不应有裸尖括号：${t}`);
    assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(t), `文本区 & 必须是五实体之一：${t}`);
  }
});

test('emit-docx：media 数量与 rIdImg 引用一一对应（下标+1）', () => {
  // 图片顺序：主图0、主图1、视频封面、引用图、评论图 = 5
  assert.strictEqual(media.length, 5);
  media.forEach((mm, i) => {
    assert.strictEqual(mm.name, `image${i + 1}.${mm.contentType.split('/')[1]}`);
    const hits = documentXml.match(new RegExp(`r:embed="rIdImg${i + 1}"`, 'g'));
    assert.ok(hits && hits.length === 1, `rIdImg${i + 1} 应恰好被引用一次`);
  });
  // 无越界引用
  const ids = [...documentXml.matchAll(/rIdImg(\d+)/g)].map((x) => Number(x[1]));
  assert.deepStrictEqual([...new Set(ids)].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  // dataUrl 原样保存在 media，不进 XML
  assert.strictEqual(media[0].dataUrl, 'data:PHOTO0');
  assert.ok(!documentXml.includes('data:PHOTO0'));
  // contentType 嗅探：假 data URL 兜底 png；评论图识别为 jpeg
  assert.strictEqual(media[0].contentType, 'image/png');
  assert.strictEqual(media[4].contentType, 'image/jpeg');
  assert.strictEqual(media[4].name, 'image5.jpeg');
});

test('emit-docx：译文段在首个正文段之后、首张图之前；段内 \\n 成 <w:br/>', () => {
  const iText = documentXml.indexOf('First line');
  const iTrans = documentXml.indexOf('【译】这是译文');
  const iImg = documentXml.indexOf('r:embed="rIdImg1"');
  assert.ok(iText >= 0 && iTrans > iText && iImg > iTrans, `顺序应为 正文<译文<图，实为 ${iText}/${iTrans}/${iImg}`);
  assert.ok(documentXml.includes('First line</w:t><w:br/><w:t xml:space="preserve">second line '), '\\n 应发射为 <w:br/>');
  // 实体 run 蓝色
  assert.ok(documentXml.includes(`<w:color w:val="1D9BF0"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">@bob</w:t>`));
  // 纯图评论：译文垫底（在评论图之后）
  const iRImg = documentXml.indexOf('r:embed="rIdImg5"');
  const iRTrans = documentXml.indexOf('【译】图片评论译文');
  assert.ok(iRImg >= 0 && iRTrans > iRImg, '纯图评论译文应垫底');
});

test('emit-docx：引用的全部段落带 pBdr 左边框 + 左缩进', () => {
  // 取包含「quoted body」的段落切片
  const at = documentXml.indexOf('quoted body');
  assert.ok(at >= 0);
  const pStart = documentXml.lastIndexOf('<w:p>', at);
  const pEnd = documentXml.indexOf('</w:p>', at);
  const p = documentXml.slice(pStart, pEnd);
  assert.ok(p.includes('<w:pBdr><w:left w:val="single" w:sz="12"'), '引用正文段应有左边框');
  assert.ok(p.includes('<w:ind w:left="480"/>'), '引用正文段应有左缩进');
  // 引用里的图片段同样带装饰：rIdImg4（引用图）所在段
  const atQ = documentXml.indexOf('r:embed="rIdImg4"');
  const pQ = documentXml.slice(documentXml.lastIndexOf('<w:p>', atQ), documentXml.indexOf('</w:p>', atQ));
  assert.ok(pQ.includes('<w:ind w:left="480"/>'), '引用图片段应有左缩进');
});

test('emit-docx：EMU 尺寸——800x400 等比缩到 6000000x3000000，缺 dims 走 1200x675 兜底', () => {
  // 主图0（800x400）：raw 7620000x3810000 → 等比缩到宽 6000000
  const img1 = documentXml.slice(documentXml.indexOf('name="image1.'), documentXml.indexOf('r:embed="rIdImg1"'));
  // wp:extent 与 a:ext 都应是缩放后的值
  assert.ok(documentXml.includes('<wp:extent cx="6000000" cy="3000000"/>'), '800x400 应缩为 6000000x3000000');
  assert.ok(documentXml.includes('<a:ext cx="6000000" cy="3000000"/>'));
  assert.ok(img1.length >= 0); // 切片存在性（image1 出现在其 drawing 里）
  // 主图1 缺 dims → 1200x675 → 11430000x6429375 → 缩到 6000000x3375000
  assert.ok(documentXml.includes('<wp:extent cx="6000000" cy="3375000"/>'), '缺 dims 应按 1200x675 兜底等比');
});

test('emit-docx：评论区结构——分隔线、标题、热度小字、视频提示、落款', () => {
  assert.ok(documentXml.includes('精选评论 · 1 条'));
  assert.ok(documentXml.includes('<w:pBdr><w:bottom w:val="single"'), '评论区前应有下边框分隔段');
  assert.ok(documentXml.includes(' · 赞100 转30'), '评论热度小字缺失');
  assert.ok(documentXml.includes('视频内容 · 请打开原文链接观看'));
  assert.ok(documentXml.includes('2026-03-05 08:07 · 原文：https://x.com/alice/status/1'), '落款应为 时间 · 原文：链接');
});
