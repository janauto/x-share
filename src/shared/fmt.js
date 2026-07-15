// 纯格式化 / 文本工具，三端共享的两栖模块。
// 收敛原本散落且重复的实现：
//   - esc           原 webpage.js
//   - fmtDate       原 card.js 与 webpage.js 逐字重复两份 → 一份
//   - parseCount / needsTranslation / avatarInitial / avatarColor  原 extract.js
//   - buildTitle    原 content.js txdocsTitle 与 txdocs.js buildTitle 同一逻辑 → 一份
//
// 无 DOM 依赖，node 可直接单测。service worker 无 window，统一挂 globalThis。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  // HTML 属性/文本转义（用于自包含网页 / 富文本片段）
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ISO 时间 → "YYYY-MM-DD HH:mm"，非法/空值返回空串
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ISO 时间 → X 原生中文格式「下午3:42 · 2026年7月15日」（仿真截图的关键保真项）。
  // 12 小时制 + 上午/下午；年月日不补零，与 X 中文界面一致。非法/空值返回空串。
  function fmtTimeNative(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const h = d.getHours();
    const period = h < 12 ? '上午' : '下午';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${period}${h12}:${mm} · ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  // 数字 → X 中文界面互动量格式：<1万 用千分位（2,912）；≥1万 用「1.2万」；≥1亿 用「1.2亿」。
  // 小数位：整数时不带 .0（1万 而非 1.0万）。负数/非数退 '0'。
  function formatCountCN(n) {
    const v = Number(n);
    if (!isFinite(v) || v < 0) return '0';
    const unit = (x, u) => {
      const s = (Math.round(x * 10) / 10).toString();
      return s + u;
    };
    if (v >= 1e8) return unit(v / 1e8, '亿');
    if (v >= 1e4) return unit(v / 1e4, '万');
    return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // 把 "1.2K" / "3.4M" / "1.2万" / "5,432" 解析成数字
  function parseCount(s) {
    if (!s) return 0;
    const t = String(s).trim().replace(/[,，\s]/g, '');
    const m = t.match(/^([\d.]+)\s*([KMkm万萬])?/);
    if (!m) return 0;
    let n = parseFloat(m[1]) || 0;
    const u = m[2];
    if (u === 'K' || u === 'k') n *= 1e3;
    else if (u === 'M' || u === 'm') n *= 1e6;
    else if (u === '万' || u === '萬') n *= 1e4;
    return Math.round(n);
  }

  // 去掉链接和 @/# 后，中文占比低于 25% 才需要翻译
  function needsTranslation(text) {
    const t = (text || '').replace(/https?:\/\/\S+|[@#]\S+/g, '').trim();
    if (!t) return false;
    const cjk = (t.match(/[一-鿿㐀-䶿]/g) || []).length;
    return cjk / t.length < 0.25;
  }

  // 头像加载失败时的「字母头像」回退：取名字/账号首字 + 稳定配色
  function avatarInitial(name, handle) {
    const s = (name || handle || '').trim().replace(/^@+/, ''); // 账号形如 @bob，去掉前导 @ 再取首字
    const ch = s ? [...s][0] : '';
    return ch ? ch.toUpperCase() : '#';
  }

  function avatarColor(seed) {
    const palette = ['#1d9bf0', '#f4212e', '#00ba7c', '#ffad1f', '#7856ff', '#f91880', '#ff7a00'];
    let h = 0;
    const s = seed || '';
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  }

  // 浮层/任务标题：作者名 + 摘要，截断到 ~max 字。空值安全。
  // 收敛原 content.js txdocsTitle 与 txdocs.js buildTitle（同一逻辑）。
  function buildTitle(name, text, max = 40) {
    const n = String(name == null ? '' : name).trim();
    const t = String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
    let s = n && t ? `${n}：${t}` : (n || t);
    if (!s) s = '推文转发';
    if (s.length > max) s = s.slice(0, max - 1) + '…';
    return s;
  }

  XS.esc = esc;
  XS.fmtDate = fmtDate;
  XS.fmtTimeNative = fmtTimeNative;
  XS.formatCountCN = formatCountCN;
  XS.parseCount = parseCount;
  XS.needsTranslation = needsTranslation;
  XS.avatarInitial = avatarInitial;
  XS.avatarColor = avatarColor;
  XS.buildTitle = buildTitle;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { esc, fmtDate, fmtTimeNative, formatCountCN, parseCount, needsTranslation, avatarInitial, avatarColor, buildTitle };
  }
})();
