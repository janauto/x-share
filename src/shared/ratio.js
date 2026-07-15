// 比例与裁切引擎（两栖纯逻辑）——设计稿 §06「把完美裁切规则化」。
//
// v1 范围：智能长图（内容自适应，默认）+ 四个固定比例预设的「补白不缩放」——
// 固定比例下内容不足时，按视觉重心（略偏上）补背景色；内容超出比例时不裁切
// （规则 1「行盒吸附」的裁切与规则 3「分页」属二期），退回智能长图并给出原因。
// 导出保持渲染宽度（600@2x=1200px ≥ 设计要求的 1200px 下限），只对齐纵横比，不重采样。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  // key → 高/宽比。参考尺寸（1080×1350 等）只定义比例，导出按渲染宽度等比换算。
  const RATIOS = {
    smart: null, // 智能长图：内容自适应高度
    '4:5': 5 / 4, // 朋友圈 / IG（1080×1350）
    '1:1': 1, // 方图（1080×1080）
    '3:4': 4 / 3, // 小红书（1242×1656）
    '9:16': 16 / 9, // 竖屏故事（1080×1920）
  };
  const RATIO_KEYS = Object.keys(RATIOS);

  // 视觉重心：文字略偏上（非几何中心），符合截图的自然观感
  const TOP_SHARE = 0.42;

  // 补白计划：给定渲染出的 (w, h) 像素与比例 key，返回
  //   { mode:'natural' }                          智能 / 未知 key —— 原样导出
  //   { mode:'pad', top, bottom, targetH }        内容不足 —— 上下补背景色
  //   { mode:'overflow', targetH }                内容超出 —— 本期不裁，退智能并注明
  function padPlan(w, h, ratioKey) {
    const aspect = RATIOS[ratioKey];
    if (!aspect || !(w > 0) || !(h > 0)) return { mode: 'natural' };
    const targetH = Math.round(w * aspect);
    if (h > targetH) return { mode: 'overflow', targetH };
    const extra = targetH - h;
    const top = Math.round(extra * TOP_SHARE);
    return { mode: 'pad', top, bottom: extra - top, targetH };
  }

  XS.ratio = { RATIOS, RATIO_KEYS, padPlan, TOP_SHARE };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RATIOS, RATIO_KEYS, padPlan, TOP_SHARE };
  }
})();
