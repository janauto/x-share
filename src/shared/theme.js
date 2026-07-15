// 主题 token 系统（两栖模块）——「无痕 Seamless」向内隐形的地基。
//
// 设计铁律（见 design/总设计构思稿.md §2.1）：卡片不硬编码颜色，运行时从
// x.com 页面实时读取当前主题（Light / Dim / Lights Out），产出图随用户主题走。
//
// 本模块把「主题 → token」这层做成纯函数（THEMES / parseRgb / pickThemeByBg /
// resolveTheme 都不碰 DOM，node 可直接单测）；唯一碰 DOM 的 detectPageBg() 用
// typeof document 守卫，node 里返回 null。service worker 无 window，统一挂 globalThis。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  // 三主题 token，值对齐设计令牌（design/设计呈现 §03）。
  // accent 系列三主题共用，故只在每个主题里内联同一份，省得发射器再查表。
  const SHARED = {
    accent: '#1D9BF0',
    accentHover: '#1A8CD8',
    like: '#F91880',
    retweet: '#00BA7C',
    error: '#F4212E',
    cinnabar: '#C3272B', // 唯一「自我表达」，仅用于工具栏图标点缀，卡片不出现
  };

  const THEMES = {
    light: {
      key: 'light',
      bg: '#FFFFFF',
      text: '#0F1419',
      text2: '#536471',
      border: '#EFF3F4',
      inputBorder: '#CFD9DE',
      elev: '#F7F9F9', // 引用/译文块等「抬高一层」的底色
      ...SHARED,
    },
    dim: {
      key: 'dim',
      bg: '#15202B',
      text: '#F7F9F9',
      text2: '#8B98A5',
      border: '#38444D',
      inputBorder: '#536471',
      elev: '#1E2732',
      ...SHARED,
    },
    lightsout: {
      key: 'lightsout',
      bg: '#000000',
      text: '#E7E9EA',
      text2: '#71767B',
      border: '#2F3336',
      inputBorder: '#333639',
      elev: '#16181C',
      ...SHARED,
    },
  };

  // 用户偏好 → 主题 key。'follow' 交给 detectPageBg 判定，其余直选。
  const PREFS = ['follow', 'light', 'dim', 'lightsout'];

  // 三主题的 body 背景 RGB 锚点，供 pickThemeByBg 就近匹配。
  const BG_ANCHORS = [
    { key: 'light', rgb: [255, 255, 255] },
    { key: 'dim', rgb: [21, 32, 43] },
    { key: 'lightsout', rgb: [0, 0, 0] },
  ];

  // "rgb(21, 32, 43)" / "rgba(0,0,0,1)" / "#15202B" → [r,g,b]；解析失败返回 null。
  function parseRgb(str) {
    if (!str) return null;
    const s = String(str).trim();
    const hex = s.match(/^#?([0-9a-f]{6})$/i);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }

  // 背景 RGB → 就近主题 key（欧氏距离）。解析失败退 'light'。
  function pickThemeByBg(rgbOrStr) {
    const rgb = Array.isArray(rgbOrStr) ? rgbOrStr : parseRgb(rgbOrStr);
    if (!rgb) return 'light';
    let best = 'light', bestD = Infinity;
    for (const a of BG_ANCHORS) {
      const d = (a.rgb[0] - rgb[0]) ** 2 + (a.rgb[1] - rgb[1]) ** 2 + (a.rgb[2] - rgb[2]) ** 2;
      if (d < bestD) { bestD = d; best = a.key; }
    }
    return best;
  }

  // 纯函数：偏好 + 页面背景串 → token 对象。
  // pref='follow' 时用 pageBg 判定；pageBg 缺失（node/detect 失败）退 light。
  function resolveTheme(pref, pageBg) {
    let key = PREFS.includes(pref) ? pref : 'follow';
    if (key === 'follow') key = pageBg ? pickThemeByBg(pageBg) : 'light';
    return THEMES[key] || THEMES.light;
  }

  // 唯一碰 DOM 的一处：读 body（退 documentElement）的实际背景色串。
  // node（无 document）返回 null，让 resolveTheme 退回 light。
  function detectPageBg() {
    if (typeof document === 'undefined' || !document.body) return null;
    try {
      const read = (el) => el && getComputedStyle(el).backgroundColor;
      const bodyBg = read(document.body);
      // body 背景透明时（rgba(...,0)）退到 <html>
      if (bodyBg && !/,\s*0\s*\)/.test(bodyBg) && bodyBg !== 'transparent') return bodyBg;
      return read(document.documentElement) || bodyBg || null;
    } catch (_) {
      return null;
    }
  }

  // 便捷：偏好 → token（内部完成 detect），供 content/pipeline 直接调。
  function themeFor(pref) {
    return resolveTheme(pref, detectPageBg());
  }

  const theme = { THEMES, PREFS, parseRgb, pickThemeByBg, resolveTheme, detectPageBg, themeFor };
  XS.theme = theme;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = theme;
  }
})();
