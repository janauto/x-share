// DOCX 容器引擎（两栖模块）—— 零依赖的 ZIP(STORE)/OPC 打包器。
//
// 职责边界：只管「容器」不管「内容」——documentXml 由调用方给全（含 <w:document>
// 根），本模块把它和媒体文件组装成最小合法 .docx（本质是一个 ZIP 包）。
//
// 全部纯函数、不碰 DOM，node 可直接单测；base64 编解码在浏览器/SW 走
// atob/btoa（分块防栈溢出），node 走 Buffer 兜底。挂 globalThis.__XS.zipdocx。
//
// ZIP 采用 STORE（不压缩）：local file header + central directory + EOCD，
// CRC-32 表驱动（IEEE 802.3 多项式 0xEDB88320）。文件名按 UTF-8 编码并置位
// 通用标志位 11（UTF-8 flag），非 ASCII 文件名也稳。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  // ---------------------------------------------------------------- CRC-32

  // 表驱动 CRC-32（反射多项式 0xEDB88320），一次性建 256 项查找表。
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  // crc32(u8) -> number（无符号 32 位）。已知向量："123456789" -> 0xCBF43926。
  function crc32(u8) {
    if (!(u8 instanceof Uint8Array)) throw new TypeError('crc32: 需要 Uint8Array');
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ------------------------------------------------------------- 编码工具

  // 字符串 → UTF-8 字节。浏览器/SW/node(≥11) 都有 TextEncoder，Buffer 兜底。
  const utf8Encode = (() => {
    if (typeof TextEncoder !== 'undefined') {
      const enc = new TextEncoder();
      return (s) => enc.encode(s);
    }
    return (s) => new Uint8Array(Buffer.from(s, 'utf8'));
  })();

  // bytesToBase64(u8) -> string。node 走 Buffer；浏览器分块 btoa（一次
  // String.fromCharCode.apply 太长会爆栈，按 32K 分块）。
  function bytesToBase64(u8) {
    if (!(u8 instanceof Uint8Array)) throw new TypeError('bytesToBase64: 需要 Uint8Array');
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
    }
    const CHUNK = 0x8000;
    let bin = '';
    for (let i = 0; i < u8.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  // dataUrlToBytes(dataUrl) -> {bytes, contentType}。仅支持 base64 data URL
  // （canvas.toDataURL / FileReader.readAsDataURL 的产物都是）；SW/浏览器用
  // atob，node 用 Buffer 兜底。contentType 缺省 application/octet-stream。
  function dataUrlToBytes(dataUrl) {
    if (typeof dataUrl !== 'string') throw new TypeError('dataUrlToBytes: 需要字符串');
    const m = /^data:([^,]*),([\s\S]*)$/.exec(dataUrl);
    if (!m) throw new Error('dataUrlToBytes: 不是合法的 data URL');
    const meta = m[1];
    if (!/;base64$/i.test(meta)) throw new Error('dataUrlToBytes: 仅支持 base64 data URL');
    const contentType = meta.slice(0, meta.indexOf(';')) || 'application/octet-stream';
    const b64 = m[2].replace(/\s+/g, ''); // data URL 里的空白按规范忽略
    let bytes;
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      bytes = new Uint8Array(Buffer.from(b64, 'base64')); // 拷贝一份，摆脱 Buffer 池共享
    } else {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
    return { bytes, contentType };
  }

  // ----------------------------------------------------------- ZIP(STORE)

  // 固定 DOS 时间戳 1980-01-01 00:00（date=0x0021, time=0x0000）：
  // 产物字节级确定（同输入同输出），便于测试与缓存比对；docx 场景不关心 mtime。
  const DOS_TIME = 0x0000;
  const DOS_DATE = 0x0021;
  const FLAG_UTF8 = 0x0800; // 通用标志位 11：文件名/注释为 UTF-8

  // buildZip(entries) -> Uint8Array。entries: [{name, data: Uint8Array}]。
  // STORE 不压缩：compressed size == uncompressed size，data 原样进包。
  function buildZip(entries) {
    if (!Array.isArray(entries)) throw new TypeError('buildZip: entries 需要数组');
    if (entries.length > 0xffff) throw new RangeError('buildZip: 条目数超出 ZIP16 上限');

    const parts = []; // 顺序拼接的字节片段
    const central = []; // 每条 entry 的中央目录记录（延后拼接）
    let offset = 0; // 当前写入位置 == 下一个 local header 的偏移

    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string' || !entry.name) {
        throw new TypeError('buildZip: entry.name 需要非空字符串');
      }
      if (!(entry.data instanceof Uint8Array)) {
        throw new TypeError(`buildZip: entry.data 需要 Uint8Array（${entry.name}）`);
      }
      const nameBytes = utf8Encode(entry.name);
      if (nameBytes.length > 0xffff) throw new RangeError(`buildZip: 文件名过长（${entry.name}）`);
      const data = entry.data;
      const crc = crc32(data);

      // local file header（30 字节定长 + 文件名），全部小端。
      const lfh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lfh.buffer);
      lv.setUint32(0, 0x04034b50, true); // 签名
      lv.setUint16(4, 20, true); // version needed to extract = 2.0
      lv.setUint16(6, FLAG_UTF8, true); // 通用标志
      lv.setUint16(8, 0, true); // method 0 = STORE
      lv.setUint16(10, DOS_TIME, true);
      lv.setUint16(12, DOS_DATE, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); // compressed size（STORE 同 raw）
      lv.setUint32(22, data.length, true); // uncompressed size
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true); // extra length
      lfh.set(nameBytes, 30);

      central.push({ nameBytes, crc, size: data.length, offset });
      parts.push(lfh, data);
      offset += lfh.length + data.length;
    }

    // central directory（每条 46 字节定长 + 文件名）。
    const cdOffset = offset;
    for (const c of central) {
      const cdh = new Uint8Array(46 + c.nameBytes.length);
      const cv = new DataView(cdh.buffer);
      cv.setUint32(0, 0x02014b50, true); // 签名
      cv.setUint16(4, 20, true); // version made by
      cv.setUint16(6, 20, true); // version needed
      cv.setUint16(8, FLAG_UTF8, true);
      cv.setUint16(10, 0, true); // STORE
      cv.setUint16(12, DOS_TIME, true);
      cv.setUint16(14, DOS_DATE, true);
      cv.setUint32(16, c.crc, true);
      cv.setUint32(20, c.size, true);
      cv.setUint32(24, c.size, true);
      cv.setUint16(28, c.nameBytes.length, true);
      cv.setUint16(30, 0, true); // extra length
      cv.setUint16(32, 0, true); // comment length
      cv.setUint16(34, 0, true); // disk number start
      cv.setUint16(36, 0, true); // internal attrs
      cv.setUint32(38, 0, true); // external attrs
      cv.setUint32(42, c.offset, true); // local header 偏移
      cdh.set(c.nameBytes, 46);
      parts.push(cdh);
      offset += cdh.length;
    }
    const cdSize = offset - cdOffset;

    // EOCD（22 字节，无注释）。
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); // 签名
    ev.setUint16(4, 0, true); // 本盘号
    ev.setUint16(6, 0, true); // 中央目录起始盘号
    ev.setUint16(8, central.length, true); // 本盘条目数
    ev.setUint16(10, central.length, true); // 总条目数
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);
    ev.setUint16(20, 0, true); // 注释长度
    parts.push(eocd);
    offset += eocd.length;

    if (cdOffset >= 0xffffffff || offset >= 0xffffffff) {
      throw new RangeError('buildZip: 体积超出 ZIP32 上限（需 ZIP64，本引擎不支持）');
    }

    const out = new Uint8Array(offset);
    let p = 0;
    for (const part of parts) {
      out.set(part, p);
      p += part.length;
    }
    return out;
  }

  // ------------------------------------------------------------ DOCX 组装

  // XML 属性/文本转义（媒体文件名可能含 & 等字符）。
  function escXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 取小写扩展名；无扩展名（或以点开头/结尾）返回 ''。
  function extOf(name) {
    const i = name.lastIndexOf('.');
    return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
  }

  const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  // [Content_Types].xml：rels/xml/png/jpeg/jpg/gif 的 Default + document.xml
  // 的 Override；媒体里出现表外扩展名时按其 contentType 补 Default，无扩展名
  // 的媒体补 Override，保证任何合法输入都能被 Word 识别。
  function contentTypesXml(media) {
    const defaults = [
      ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
      ['xml', 'application/xml'],
      ['png', 'image/png'],
      ['jpeg', 'image/jpeg'],
      ['jpg', 'image/jpeg'],
      ['gif', 'image/gif'],
    ];
    const seen = new Set(defaults.map((d) => d[0]));
    const overrides = [
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    ];
    for (const m of media) {
      const ext = extOf(m.name);
      const ct = m.contentType || 'application/octet-stream';
      if (ext) {
        if (!seen.has(ext)) {
          seen.add(ext);
          defaults.push([ext, ct]);
        }
      } else {
        overrides.push(
          `<Override PartName="/word/media/${escXml(m.name)}" ContentType="${escXml(ct)}"/>`
        );
      }
    }
    return (
      XML_DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      defaults
        .map(([ext, ct]) => `<Default Extension="${escXml(ext)}" ContentType="${escXml(ct)}"/>`)
        .join('') +
      overrides.join('') +
      '</Types>'
    );
  }

  const RELS_ROOT =
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  // word/_rels/document.xml.rels：媒体关系 rId 从 rIdImg1 起（documentXml 里
  // 的 <a:blip r:embed="rIdImgN"/> 按此约定引用），Target 指向 media/<name>。
  function documentRelsXml(media) {
    return (
      XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      media
        .map(
          (m, i) =>
            `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${escXml(m.name)}"/>`
        )
        .join('') +
      '</Relationships>'
    );
  }

  // docxFromXml({documentXml, media}) -> Uint8Array（完整 .docx 字节）。
  // documentXml 由调用方给全（含 <w:document> 根），本模块不做内容映射。
  // media: [{name, data: Uint8Array, contentType}]，进包路径 word/media/<name>。
  function docxFromXml({ documentXml, media = [] } = {}) {
    if (typeof documentXml !== 'string' || !documentXml) {
      throw new TypeError('docxFromXml: documentXml 需要非空字符串');
    }
    if (!Array.isArray(media)) throw new TypeError('docxFromXml: media 需要数组');
    for (const m of media) {
      if (!m || typeof m.name !== 'string' || !m.name) {
        throw new TypeError('docxFromXml: media[].name 需要非空字符串');
      }
      if (m.name.includes('/') || m.name.includes('\\')) {
        throw new Error(`docxFromXml: media 名不能含路径分隔符（${m.name}）`);
      }
      if (!(m.data instanceof Uint8Array)) {
        throw new TypeError(`docxFromXml: media[].data 需要 Uint8Array（${m.name}）`);
      }
    }

    const entries = [
      { name: '[Content_Types].xml', data: utf8Encode(contentTypesXml(media)) },
      { name: '_rels/.rels', data: utf8Encode(RELS_ROOT) },
      { name: 'word/document.xml', data: utf8Encode(documentXml) },
      { name: 'word/_rels/document.xml.rels', data: utf8Encode(documentRelsXml(media)) },
    ];
    for (const m of media) {
      entries.push({ name: `word/media/${m.name}`, data: m.data });
    }
    return buildZip(entries);
  }

  const zipdocx = { crc32, buildZip, docxFromXml, dataUrlToBytes, bytesToBase64 };
  XS.zipdocx = zipdocx;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = zipdocx;
  }
})();
