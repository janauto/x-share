'use strict';
// 覆盖面广的假 payload 喂给四个发射器，断言关键结构不变：
// 译文位置、图片顺序、引用嵌套、esc 转义、评论热度。
const { test } = require('node:test');
const assert = require('node:assert');

// ---- 极简 DOM stub（覆盖 emit-card 用到的 API，含 SVG createElementNS / setAttribute）----
function makeEl(tag) {
  return {
    nodeType: 1, tag, _text: null, _src: null, _attrs: {}, children: [],
    style: { set cssText(v) { this._v = v; }, get cssText() { return this._v || ''; } },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; },
    set src(v) { this._src = v; },
    get src() { return this._src; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
  };
}
global.window = global;
global.document = {
  createElement: (tag) => makeEl(tag),
  createElementNS: (_ns, tag) => makeEl(tag), // SVG 图标
  createTextNode: (text) => ({ nodeType: 3, _text: text }),
};

require('../src/shared/fmt.js');
require('../src/shared/theme.js');
require('../src/shared/blocks.js');
require('../src/shared/ir.js');
require('../src/content/render/emit-card.js');
require('../src/content/render/emit-page.js');
require('../src/content/render/emit-rich.js');
require('../src/content/render/emit-text.js');
const XS = global.__XS;
const LIGHT = XS.theme.THEMES.light;
const DIM = XS.theme.THEMES.dim;

const seg = (text, type) => ({ type: type || 'text', text });

// 主推文：blocks 穿插图文（文字→图→文字），带译文、视频、引用；含需转义字符
const main = {
  name: 'Alice <A&B>', handle: '@alice', avatarData: 'data:ava',
  permalink: 'https://x.com/alice/status/1', datetime: '2026-03-05T08:07:00',
  translation: '这是译文',
  blocks: [
    { type: 'text', segments: [seg('First '), seg('@bob', 'ent')] },
    { type: 'photos', idx: [0, 1] },
    { type: 'text', segments: [seg('After image')] },
    { type: 'video' },
    { type: 'quote' },
  ],
  segments: [seg('First '), seg('@bob', 'ent'), seg('After image')],
  photosData: ['data:PHOTO0', 'data:PHOTO1'],
  hasVideo: true, videoPosterData: 'data:VPOSTER',
  quote: {
    name: 'Q<&>', handle: '@quoted', avatarData: null, permalink: 'https://x.com/q/status/9', datetime: null,
    translation: '引用译文',
    blocks: [{ type: 'text', segments: [seg('quoted body')] }, { type: 'photos', idx: [0] }],
    segments: [seg('quoted body')], photosData: ['data:QPHOTO'],
    hasVideo: false, videoPosterData: null, quote: null,
  },
};
// 纯图评论 + 译文（译文垫底）+ 热度
const pureImgReply = {
  name: 'Img', handle: '@img', avatarData: null, permalink: 'https://x.com/img/status/2',
  datetime: null, translation: '图片评论译文',
  blocks: [{ type: 'photos', idx: [0] }],
  segments: [], photosData: ['data:RPHOTO'], hasVideo: false, videoPosterData: null, quote: null,
  engagement: { score: 137, likes: 100, retweets: 30, replies: 7 },
};
const payload = { main, replies: [pureImgReply] };

// ---------- emit-page ----------
test('emit-page：译文块紧跟首个正文块、在图片之前', () => {
  const html = XS.buildWebpageHtml(payload);
  const iText = html.indexOf('First ');
  const iTrans = html.indexOf('<div class="trans">这是译文');
  const iPhotos = html.indexOf('data:PHOTO0');
  assert.ok(iText >= 0 && iTrans > iText && iPhotos > iTrans, `顺序应为 正文<译文<图片，实为 ${iText}/${iTrans}/${iPhotos}`);
});

test('emit-page：图片按文档顺序（PHOTO0 在 PHOTO1 前，均在「After image」正文之前）', () => {
  const html = XS.buildWebpageHtml(payload);
  assert.ok(html.indexOf('data:PHOTO0') < html.indexOf('data:PHOTO1'));
  assert.ok(html.indexOf('data:PHOTO1') < html.indexOf('After image'));
});

test('emit-page：引用嵌套且引用正文在引用块内', () => {
  const html = XS.buildWebpageHtml(payload);
  const q0 = html.indexOf('<div class="quote">');
  assert.ok(q0 >= 0);
  assert.ok(html.indexOf('quoted body') > q0);
  assert.ok(html.indexOf('data:QPHOTO') > q0);
});

test('emit-page：esc 转义 name 里的 < & >', () => {
  const html = XS.buildWebpageHtml(payload);
  assert.ok(html.includes('Alice &lt;A&amp;B&gt;'));
  assert.ok(!html.includes('Alice <A&B>'));
});

test('emit-page：评论热度渲染点赞/转推/回复数字', () => {
  const html = XS.buildWebpageHtml(payload);
  assert.ok(html.includes('<div class="eng">❤ 100 · 🔁 30 · 💬 7</div>'));
});

test('emit-page：纯图评论的译文在图片之后（垫底）', () => {
  const html = XS.buildWebpageHtml(payload);
  const iRphoto = html.indexOf('data:RPHOTO');
  const iRtrans = html.indexOf('图片评论译文');
  assert.ok(iRphoto >= 0 && iRtrans > iRphoto);
});

test('emit-page：视频块渲染封面 + 提示', () => {
  const html = XS.buildWebpageHtml(payload);
  assert.ok(html.includes('data:VPOSTER'));
  assert.ok(html.includes('🎬 视频内容'));
});

// ---------- emit-rich ----------
test('emit-rich：译文块在首个正文之后、图片之前，且转义生效', () => {
  const html = XS.buildRichHtml(payload);
  const iText = html.indexOf('First ');
  const iTrans = html.indexOf('这是译文');
  const iPhotos = html.indexOf('data:PHOTO0');
  assert.ok(iText >= 0 && iTrans > iText && iPhotos > iTrans);
  assert.ok(html.includes('Q&lt;&amp;&gt;')); // 引用作者名转义
});

test('emit-rich：引用作为内嵌块、含引用正文与图片', () => {
  const html = XS.buildRichHtml(payload);
  assert.ok(html.includes('quoted body'));
  assert.ok(html.includes('data:QPHOTO'));
});

// ---------- emit-text ----------
test('emit-text：正文聚合后接【译】，引用缩进两格', () => {
  const text = XS.buildPlainText(payload);
  const lines = text.split('\n');
  // 主推文名字行
  assert.ok(lines[0].includes('Alice <A&B>')); // 纯文本不转义
  // 正文是两段文本块聚合（First @bob + After image）
  assert.ok(text.includes('First @bobAfter image'));
  // 译文行
  assert.ok(text.includes('【译】这是译文'));
  // 引用缩进两格
  assert.ok(text.includes('  Q<&> @quoted'));
  assert.ok(text.includes('  quoted body'));
  // 原文链接兜底
  assert.ok(text.includes('原文：https://x.com/alice/status/1'));
});

test('emit-text：评论段落与「— 精选评论 —」分隔', () => {
  const text = XS.buildPlainText(payload);
  assert.ok(text.includes('— 精选评论 —'));
  assert.ok(text.includes('图片评论译文')); // 评论译文（纯图评论也带译文）
});

// ---------- emit-card（DOM stub 结构断言，双皮肤 + 主题跟随）----------
function flatten(node, out) {
  if (!node) return out;
  if (node.nodeType === 3) { out.push({ text: node._text }); return out; }
  out.push({ css: node.style ? node.style.cssText : '', text: node._text, src: node._src, attrs: node._attrs || {} });
  (node.children || []).forEach((c) => flatten(c, out));
  return out;
}
const cardPay = (extra) => Object.assign({ main, replies: [pureImgReply] }, extra);

test('emit-card native（默认皮肤）：原生翻译标签 + 原生时间行 + 蓝勾/ X logo，无蓝边译文块', () => {
  const root = XS.buildCard(cardPay({ main: { ...main, verified: true, verifiedKind: 'blue' }, theme: LIGHT, cardStyle: 'native' }));
  assert.strictEqual(root.tag, 'div');
  const flat = flatten(root, []);
  const texts = flat.map((n) => n.text).filter((t) => t != null);
  const css = flat.map((n) => n.css || '');
  const attrs = flat.map((n) => n.attrs || {});
  assert.ok(texts.includes('已翻译自 英语'), '原生翻译标签缺失');
  assert.ok(texts.includes('这是译文'), '纯文本译文缺失');
  assert.ok(texts.includes('上午8:07 · 2026年3月5日'), '原生时间行缺失');
  assert.ok(attrs.some((a) => a.d && a.d.startsWith('M22.25 12c0-1.43')), '蓝勾徽章 SVG 缺失');
  assert.ok(attrs.some((a) => a.d && a.d.startsWith('M18.244 2.25')), 'X logo SVG 缺失');
  assert.ok(!css.some((c) => c.includes('border-left:3px solid')), 'native 不应出现蓝边译文块');
});

test('emit-card native：译文块紧跟首个正文、在图片之前；图片按序', () => {
  const flat = flatten(XS.buildCard(cardPay({ theme: LIGHT, cardStyle: 'native' })), []);
  const texts = flat.map((n) => n.text);
  const iText = texts.indexOf('First ');
  const iTransLbl = texts.indexOf('已翻译自 英语');
  const srcs = flat.map((n) => n.src).filter(Boolean);
  assert.ok(iText >= 0 && iTransLbl > iText, '译文应紧跟首个正文');
  assert.ok(srcs.indexOf('data:PHOTO0') >= 0 && srcs.indexOf('data:PHOTO0') < srcs.indexOf('data:PHOTO1'));
});

test('emit-card reading（第二皮肤）：蓝边译文块 + 16.5px 主正文，无原生翻译标签', () => {
  const flat = flatten(XS.buildCard(cardPay({ theme: LIGHT, cardStyle: 'reading' })), []);
  const css = flat.map((n) => n.css || '');
  const texts = flat.map((n) => n.text).filter((t) => t != null);
  assert.ok(css.some((c) => c.includes('font-size:16.5px')), '阅读风主正文 16.5px 缺失');
  assert.ok(css.some((c) => c.includes('border-left:3px solid #1D9BF0')), '蓝边译文块缺失（accent token）');
  assert.ok(!texts.includes('已翻译自 英语'), 'reading 不应有原生翻译标签');
  assert.ok(texts.some((t) => t === '精选评论 · 1 条'));
});

test('emit-card：主题跟随——dim 主题用 dim token 着色 + 深色描边', () => {
  const root = XS.buildCard(cardPay({ replies: [], theme: DIM, cardStyle: 'native' }));
  const rootCss = root.style.cssText;
  assert.ok(rootCss.includes('background:#15202B'), 'dim 背景缺失');
  assert.ok(rootCss.includes('color:#F7F9F9'), 'dim 文字缺失');
  assert.ok(rootCss.includes('border:1px solid #38444D'), '深色描边缺失');
});

test('emit-card：light 主题不加描边', () => {
  const root = XS.buildCard(cardPay({ replies: [], theme: LIGHT, cardStyle: 'native' }));
  assert.ok(!root.style.cssText.includes('border:1px solid'), 'light 不应加整卡描边');
});

test('emit-card：引用框含引用作者名与引用图片；纯图评论头像字母回退', () => {
  const flat = flatten(XS.buildCard(cardPay({ theme: LIGHT, cardStyle: 'native' })), []);
  const texts = flat.map((n) => n.text).filter((t) => t != null);
  const srcs = flat.map((n) => n.src).filter(Boolean);
  assert.ok(texts.includes('Q<&>')); // 卡片用 textContent，不转义（栅格化）
  assert.ok(srcs.includes('data:QPHOTO'));
  assert.ok(texts.includes('I')); // 纯图评论 Img 首字母
});
