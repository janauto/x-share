'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const zipdocx = require('../src/shared/zipdocx.js');

const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------- 手写 ZIP 解析器
// 独立于被测代码：只按 ZIP 规范读字节，用来断言 buildZip 的产物结构正确。
function parseZip(u8) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // EOCD 定长 22 字节且我们不写注释 → 一定在末尾。
  const eocdOff = u8.length - 22;
  assert.strictEqual(view.getUint32(eocdOff, true), 0x06054b50, 'EOCD 签名');
  const eocd = {
    diskNo: view.getUint16(eocdOff + 4, true),
    cdDisk: view.getUint16(eocdOff + 6, true),
    countThisDisk: view.getUint16(eocdOff + 8, true),
    count: view.getUint16(eocdOff + 10, true),
    cdSize: view.getUint32(eocdOff + 12, true),
    cdOffset: view.getUint32(eocdOff + 16, true),
    commentLen: view.getUint16(eocdOff + 20, true),
  };

  const entries = [];
  let p = eocd.cdOffset;
  for (let i = 0; i < eocd.count; i++) {
    assert.strictEqual(view.getUint32(p, true), 0x02014b50, `central 签名 #${i}`);
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const csize = view.getUint32(p + 20, true);
    const usize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));

    // 跟到 local file header 校验签名与自身文件名，再抠出数据。
    assert.strictEqual(view.getUint32(localOff, true), 0x04034b50, `local 签名（${name}）`);
    const localNameLen = view.getUint16(localOff + 26, true);
    const localExtraLen = view.getUint16(localOff + 28, true);
    const localName = dec.decode(u8.subarray(localOff + 30, localOff + 30 + localNameLen));
    assert.strictEqual(localName, name, 'local/central 文件名一致');
    assert.strictEqual(view.getUint32(localOff + 14, true), crc, 'local/central CRC 一致');
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const data = u8.subarray(dataStart, dataStart + csize);

    entries.push({ name, flags, method, crc, csize, usize, localOff, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  assert.strictEqual(p - eocd.cdOffset, eocd.cdSize, 'cdSize 与实际中央目录长度一致');
  return { eocd, entries };
}

// ----------------------------------------------------------------- CRC-32

test('crc32：已知向量', () => {
  assert.strictEqual(zipdocx.crc32(enc.encode('123456789')), 0xcbf43926);
  assert.strictEqual(zipdocx.crc32(new Uint8Array(0)), 0);
  assert.strictEqual(zipdocx.crc32(enc.encode('a')), 0xe8b7be43);
  assert.strictEqual(zipdocx.crc32(enc.encode('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

test('crc32：与 node:zlib.crc32 对拍（随机数据）', (t) => {
  if (typeof zlib.crc32 !== 'function') return t.skip('本 node 版本无 zlib.crc32');
  for (const len of [1, 7, 256, 4096]) {
    const buf = new Uint8Array(len);
    for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256);
    assert.strictEqual(zipdocx.crc32(buf), zlib.crc32(buf) >>> 0, `len=${len}`);
  }
});

test('crc32：非 Uint8Array 抛错', () => {
  assert.throws(() => zipdocx.crc32('123456789'), TypeError);
});

// ---------------------------------------------------------------- buildZip

test('buildZip：EOCD / central / local 结构逐字节正确', () => {
  const a = enc.encode('hello zip');
  const b = new Uint8Array(256);
  for (let i = 0; i < 256; i++) b[i] = i;
  const out = zipdocx.buildZip([
    { name: 'a.txt', data: a },
    { name: 'dir/b.bin', data: b },
  ]);
  assert.ok(out instanceof Uint8Array);

  const { eocd, entries } = parseZip(out);
  assert.strictEqual(eocd.count, 2);
  assert.strictEqual(eocd.countThisDisk, 2);
  assert.strictEqual(eocd.diskNo, 0);
  assert.strictEqual(eocd.commentLen, 0);

  // 第一条：local header 从 0 开始。
  assert.strictEqual(entries[0].name, 'a.txt');
  assert.strictEqual(entries[0].localOff, 0);
  assert.strictEqual(entries[0].method, 0, 'STORE');
  assert.ok(entries[0].flags & 0x0800, 'UTF-8 flag 置位');
  assert.strictEqual(entries[0].csize, a.length);
  assert.strictEqual(entries[0].usize, a.length);
  assert.strictEqual(entries[0].crc, zipdocx.crc32(a));
  assert.deepStrictEqual(Array.from(entries[0].data), Array.from(a));

  // 第二条：偏移 = 上一条 local header(30+5) + 数据长度。
  assert.strictEqual(entries[1].name, 'dir/b.bin');
  assert.strictEqual(entries[1].localOff, 30 + 5 + a.length);
  assert.strictEqual(entries[1].csize, 256);
  assert.strictEqual(entries[1].crc, zipdocx.crc32(b));
  assert.deepStrictEqual(Array.from(entries[1].data), Array.from(b));

  // 中央目录紧跟在最后一条数据之后。
  assert.strictEqual(eocd.cdOffset, entries[1].localOff + 30 + 9 + 256);
});

test('buildZip：UTF-8 文件名与空数据条目', () => {
  const out = zipdocx.buildZip([
    { name: '中文名.txt', data: enc.encode('你好') },
    { name: 'empty.bin', data: new Uint8Array(0) },
  ]);
  const { entries } = parseZip(out);
  assert.strictEqual(entries[0].name, '中文名.txt');
  assert.strictEqual(dec.decode(entries[0].data), '你好');
  assert.strictEqual(entries[1].csize, 0);
  assert.strictEqual(entries[1].crc, 0);
});

test('buildZip：零条目 → 只有 EOCD', () => {
  const out = zipdocx.buildZip([]);
  assert.strictEqual(out.length, 22);
  const { eocd, entries } = parseZip(out);
  assert.strictEqual(eocd.count, 0);
  assert.strictEqual(eocd.cdSize, 0);
  assert.strictEqual(eocd.cdOffset, 0);
  assert.strictEqual(entries.length, 0);
});

test('buildZip：产物字节级确定（同输入同输出）', () => {
  const mk = () => zipdocx.buildZip([{ name: 'x.txt', data: enc.encode('same') }]);
  assert.deepStrictEqual(Array.from(mk()), Array.from(mk()));
});

test('buildZip：非法输入抛错', () => {
  assert.throws(() => zipdocx.buildZip('nope'), TypeError);
  assert.throws(() => zipdocx.buildZip([{ name: '', data: new Uint8Array(0) }]), TypeError);
  assert.throws(() => zipdocx.buildZip([{ name: 'a', data: [1, 2, 3] }]), TypeError);
});

// -------------------------------------------------------------- docxFromXml

test('docxFromXml：五类文件齐全，document.xml 原样保留', () => {
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body><w:p><w:r><w:t>你好 docx &amp; zip</w:t></w:r></w:p></w:body></w:document>';
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);

  const out = zipdocx.docxFromXml({
    documentXml,
    media: [
      { name: 'img1.png', data: png, contentType: 'image/png' },
      { name: 'img2.jpg', data: jpg, contentType: 'image/jpeg' },
    ],
  });

  const { entries } = parseZip(out);
  const byName = new Map(entries.map((e) => [e.name, e]));

  // 五类文件齐全。
  for (const name of [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
    'word/_rels/document.xml.rels',
    'word/media/img1.png',
  ]) {
    assert.ok(byName.has(name), `缺少 ${name}`);
  }
  assert.ok(byName.has('word/media/img2.jpg'), '缺少 word/media/img2.jpg');
  assert.strictEqual(entries.length, 6);

  // document.xml 原样保留（本模块不做内容映射）。
  assert.strictEqual(dec.decode(byName.get('word/document.xml').data), documentXml);

  // [Content_Types].xml：png/jpeg/gif Default + document.xml Override。
  const ct = dec.decode(byName.get('[Content_Types].xml').data);
  assert.match(ct, /<Default Extension="png" ContentType="image\/png"\/>/);
  assert.match(ct, /<Default Extension="jpeg" ContentType="image\/jpeg"\/>/);
  assert.match(ct, /<Default Extension="gif" ContentType="image\/gif"\/>/);
  assert.match(ct, /<Override PartName="\/word\/document\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml"\/>/);

  // _rels/.rels 指向 word/document.xml。
  const rels = dec.decode(byName.get('_rels/.rels').data);
  assert.match(rels, /Type="[^"]*officeDocument"\s+Target="word\/document\.xml"/);

  // word/_rels/document.xml.rels：rId 从 rIdImg1 起，Target=media/<name>。
  const docRels = dec.decode(byName.get('word/_rels/document.xml.rels').data);
  assert.match(docRels, /Id="rIdImg1"[^>]*Target="media\/img1\.png"/);
  assert.match(docRels, /Id="rIdImg2"[^>]*Target="media\/img2\.jpg"/);

  // 媒体字节原样进包。
  assert.deepStrictEqual(Array.from(byName.get('word/media/img1.png').data), Array.from(png));
  assert.deepStrictEqual(Array.from(byName.get('word/media/img2.jpg').data), Array.from(jpg));
});

test('docxFromXml：无媒体也合法（rels 为空列表）', () => {
  const documentXml = '<w:document/>';
  const out = zipdocx.docxFromXml({ documentXml });
  const { entries } = parseZip(out);
  assert.strictEqual(entries.length, 4);
  const docRels = dec.decode(entries.find((e) => e.name === 'word/_rels/document.xml.rels').data);
  assert.ok(!/rIdImg/.test(docRels));
});

test('docxFromXml：表外扩展名补 Default，无扩展名补 Override', () => {
  const out = zipdocx.docxFromXml({
    documentXml: '<w:document/>',
    media: [
      { name: 'pic.webp', data: new Uint8Array([1]), contentType: 'image/webp' },
      { name: 'noext', data: new Uint8Array([2]), contentType: 'image/png' },
    ],
  });
  const { entries } = parseZip(out);
  const ct = dec.decode(entries.find((e) => e.name === '[Content_Types].xml').data);
  assert.match(ct, /<Default Extension="webp" ContentType="image\/webp"\/>/);
  assert.match(ct, /<Override PartName="\/word\/media\/noext" ContentType="image\/png"\/>/);
});

test('docxFromXml：非法输入抛错', () => {
  assert.throws(() => zipdocx.docxFromXml(), TypeError);
  assert.throws(() => zipdocx.docxFromXml({ documentXml: '' }), TypeError);
  assert.throws(
    () => zipdocx.docxFromXml({ documentXml: '<w:document/>', media: [{ name: 'a/b.png', data: new Uint8Array(0) }] }),
    /路径分隔符/
  );
});

// ------------------------------------------------ base64 / data URL 编解码

test('bytesToBase64 / dataUrlToBytes：往返一致', () => {
  const bytes = new Uint8Array(1000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) % 256;
  const b64 = zipdocx.bytesToBase64(bytes);
  assert.strictEqual(b64, Buffer.from(bytes).toString('base64'), '与 Buffer 编码一致');

  const { bytes: back, contentType } = zipdocx.dataUrlToBytes(`data:image/png;base64,${b64}`);
  assert.strictEqual(contentType, 'image/png');
  assert.deepStrictEqual(Array.from(back), Array.from(bytes));
});

test('bytesToBase64：空输入与边界长度（分块无缝）', () => {
  assert.strictEqual(zipdocx.bytesToBase64(new Uint8Array(0)), '');
  for (const len of [1, 2, 3, 0x7fff, 0x8000, 0x8001]) {
    const u8 = new Uint8Array(len).fill(0xab);
    assert.strictEqual(zipdocx.bytesToBase64(u8), Buffer.from(u8).toString('base64'), `len=${len}`);
  }
});

test('bytesToBase64：subarray 视图（非零 byteOffset）编码正确', () => {
  const base = new Uint8Array([9, 9, 1, 2, 3, 9]);
  const view = base.subarray(2, 5); // [1,2,3]
  assert.strictEqual(zipdocx.bytesToBase64(view), Buffer.from([1, 2, 3]).toString('base64'));
});

test('dataUrlToBytes：带参数的 media type 与缺省 content type', () => {
  const b64 = Buffer.from('hi').toString('base64');
  // mediatype 带参数：contentType 取分号前的主类型
  const r1 = zipdocx.dataUrlToBytes(`data:text/plain;charset=utf-8;base64,${b64}`);
  assert.strictEqual(r1.contentType, 'text/plain');
  assert.strictEqual(dec.decode(r1.bytes), 'hi');
  // 无 mediatype：缺省 application/octet-stream
  const r2 = zipdocx.dataUrlToBytes(`data:;base64,${b64}`);
  assert.strictEqual(r2.contentType, 'application/octet-stream');
});

test('dataUrlToBytes：非法输入抛错', () => {
  assert.throws(() => zipdocx.dataUrlToBytes(null), TypeError);
  assert.throws(() => zipdocx.dataUrlToBytes('http://x.com/a.png'), /data URL/);
  assert.throws(() => zipdocx.dataUrlToBytes('data:text/plain,hello'), /base64/);
});

// ------------------------------------------------------------ 端到端冒烟

test('端到端：dataUrl → media → docx → 解包回读字节一致', () => {
  const raw = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 4, 5]);
  const dataUrl = `data:image/png;base64,${zipdocx.bytesToBase64(raw)}`;
  const { bytes, contentType } = zipdocx.dataUrlToBytes(dataUrl);
  const out = zipdocx.docxFromXml({
    documentXml: '<w:document/>',
    media: [{ name: 'shot.png', data: bytes, contentType }],
  });
  const { entries } = parseZip(out);
  const media = entries.find((e) => e.name === 'word/media/shot.png');
  assert.deepStrictEqual(Array.from(media.data), Array.from(raw));
  assert.strictEqual(media.crc, zipdocx.crc32(raw));
});
