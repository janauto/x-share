// 敏感内容屏蔽 / 打码。
// 两种文本模式：规则匹配（本地正则，默认）与模型匹配（走后台调 LLM）。
// 图片打码：canvas 像素化（马赛克）。
// 说明：本模块只提供「机制」，不内置任何政治敏感词表——敏感词由用户自行在设置里填写；
// 内置的仅是可选的 PII（手机号/邮箱/长数字）正则，帮用户避免误发个人信息。

(() => {
  const XS = (window.__XS = window.__XS || {});

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 把用户输入的词表编译成正则数组。
  // 每行/每项：普通词按字面匹配；用 /pattern/flags 包裹的按正则处理。
  XS.compileRedactTerms = function (termsStr, includePII) {
    const out = [];
    (termsStr || '')
      .split(/[\n,，]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((t) => {
        const m = t.match(/^\/(.+)\/([a-z]*)$/i);
        try {
          if (m) {
            // 去重 flags 并确保带 g（例如误写 /foo/gg 会导致 RegExp 抛错）
            const uniq = [...new Set(m[2].split(''))];
            if (!uniq.includes('g')) uniq.push('g');
            out.push(new RegExp(m[1], uniq.join('')));
          } else {
            out.push(new RegExp(escapeRe(t), 'g'));
          }
        } catch (_) {
          // 正则无效：退回按「内部模式」字面量匹配，而不是把整段 /.../ 当字面量
          // （否则用户想屏蔽的词会静默漏网，对安全功能是危险的）
          out.push(new RegExp(escapeRe(m ? m[1] : t), 'g'));
        }
      });
    if (includePII) {
      out.push(
        /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, // 手机号
        /[\w.+-]+@[\w-]+\.[\w.-]+/g, // 邮箱
        /(?<!\d)\d{15,19}(?!\d)/g // 身份证 / 银行卡等长数字
      );
    }
    return out;
  };

  // 用 █ 覆盖命中的可见字符（保留空白，长度对齐）
  XS.redactText = function (str, terms) {
    if (!str || !terms || !terms.length) return str;
    let out = str;
    for (const re of terms) {
      re.lastIndex = 0;
      out = out.replace(re, (m) => m.replace(/\S/g, '█'));
    }
    return out;
  };

  // 图片像素化打码：缩小再放大，制造马赛克。data URL 输入不会污染画布。
  XS.pixelateDataUrl = function (dataUrl, block) {
    block = block || 14;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return resolve(dataUrl);
        const sw = Math.max(1, Math.round(w / block));
        const sh = Math.max(1, Math.round(h / block));
        const small = document.createElement('canvas');
        small.width = sw; small.height = sh;
        small.getContext('2d').drawImage(img, 0, 0, sw, sh);

        const big = document.createElement('canvas');
        big.width = w; big.height = h;
        const ctx = big.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
        try {
          resolve(big.toDataURL('image/png'));
        } catch (_) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };
})();
