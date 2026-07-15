'use strict';
// 覆盖面广的假 payload 喂给四个发射器，断言关键结构不变：
// 译文位置、图片顺序、引用嵌套、esc 转义、评论热度。
const { test } = require('node:test');
const assert = require('node:assert');

// ---- 极简 DOM stub（仅覆盖 emit-card 用到的 API），须在 require emit-card 前就位 ----
function makeEl(tag) {
  return {
    nodeType: 1, tag, _text: null, _src: null, children: [],
    style: { set cssText(v) { this._v = v; }, get cssText() { return this._v || ''; } },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; },
    set src(v) { this._src = v; },
    get src() { return this._src; },
    appendChild(c) { this.children.push(c); return c; },
  };
}
global.window = global;
global.document = {
  createElement: (tag) => makeEl(tag),
  createTextNode: (text) => ({ nodeType: 3, _text: text }),
};

require('../src/shared/fmt.js');
require('../src/shared/blocks.js');
require('../src/shared/ir.js');
require('../src/content/render/emit-card.js');
require('../src/content/render/emit-page.js');
require('../src/content/render/emit-rich.js');
require('../src/content/render/emit-text.js');
const XS = global.__XS;

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

// ---------- emit-card（DOM stub 结构断言）----------
function flatten(node, out) {
  if (!node) return out;
  if (node.nodeType === 3) { out.push({ text: node._text }); return out; }
  out.push({ css: node.style.cssText, text: node._text, src: node._src });
  node.children.forEach((c) => flatten(c, out));
  return out;
}

test('emit-card：生成根节点且译文块位置正确（正文<译文<图片）', () => {
  const root = XS.buildCard(payload);
  assert.strictEqual(root.tag, 'div');
  const flat = flatten(root, []);
  const css = flat.map((n) => n.css || '');
  // 主上下文正文 font-size:16.5px；主译文 font-size:17px + border-left；图片网格 display:grid
  const iText = css.findIndex((c) => c.includes('font-size:16.5px'));
  const iTrans = css.findIndex((c) => c.includes('font-size:17px') && c.includes('border-left:3px solid #1d9bf0'));
  const iGrid = css.findIndex((c) => c.includes('display:grid'));
  assert.ok(iText >= 0 && iTrans > iText && iGrid > iTrans, `card 顺序 ${iText}/${iTrans}/${iGrid}`);
});

test('emit-card：图片按顺序内联（PHOTO0 先于 PHOTO1）', () => {
  const flat = flatten(XS.buildCard(payload), []);
  const srcs = flat.map((n) => n.src).filter(Boolean);
  assert.ok(srcs.indexOf('data:PHOTO0') >= 0);
  assert.ok(srcs.indexOf('data:PHOTO0') < srcs.indexOf('data:PHOTO1'));
});

test('emit-card：引用框内含引用作者名与引用图片', () => {
  const flat = flatten(XS.buildCard(payload), []);
  const texts = flat.map((n) => n.text).filter((t) => t != null);
  assert.ok(texts.includes('Q<&>')); // 卡片用 textContent，不转义（栅格化）
  const srcs = flat.map((n) => n.src).filter(Boolean);
  assert.ok(srcs.includes('data:QPHOTO'));
});

test('emit-card：评论区标题与热度评论头像字母回退', () => {
  const flat = flatten(XS.buildCard(payload), []);
  const texts = flat.map((n) => n.text).filter((t) => t != null);
  assert.ok(texts.some((t) => t === '精选评论 · 1 条'));
  // 纯图评论无 avatarData → 字母头像 'I'（Img 首字母）
  assert.ok(texts.includes('I'));
});
