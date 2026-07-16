// 配置 schema —— DEFAULTS 的唯一来源，三端共享。
//
// 加载方式（两栖模块）：
//   - service worker：background.js 顶部 importScripts('shared/config-schema.js')，
//     随后从 globalThis.__XS 取 DEFAULTS / normalizeConfig；
//   - options 设置页：options.html 用 <script src="../shared/config-schema.js"> 先引，
//     options.js 从 window.__XS 取 DEFAULTS；
//   - 内容脚本：manifest content_scripts 里排在最前，content.js 经 onChanged 复用 normalizeConfig。
//
// service worker 没有 window，一律挂 globalThis；node 单测走 module.exports。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  // 合并原 background.js 与 options/options.js 两份 DEFAULTS。
  // 差异吸收：background 版独有 updateCheckIntervalHours（options 版缺失，现补入）。
  // publishTarget 合法值：'none' | 'gist' | 'custom' | 'cloudbase'。
  const DEFAULTS = {
    apiKey: '',
    apiBase: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    translateDefault: true,
    // 评论：进入选择模式时自动按热度选取前 N 条
    autoHotDefault: true,
    autoHotN: 10,
    // 卡片外观（「无痕 Seamless」新版；成图控制台改动即记忆）
    cardTheme: 'follow', // 'follow' | 'light' | 'dim' | 'lightsout'（follow=跟随 X 当前主题）
    cardStyle: 'native', // 'native'（X 原生截图风）| 'reading'（阅读排版风）
    cardRatio: 'smart', // 'smart' | '4:5' | '1:1' | '3:4' | '9:16'
    cardShowEng: true, // 显示·互动数据
    cardShowTime: true, // 显示·时间
    cardShowFooter: false, // 显示·落款（原文链接行）——默认关，真截图不带来源行
    // 敏感内容屏蔽
    redactEnabled: false,
    redactMode: 'rules', // 'rules' | 'model'
    redactTerms: '',
    redactPII: false,
    redactImages: false,
    // 网页发布后端
    publishTarget: 'none', // 'none' | 'gist' | 'custom' | 'cloudbase'
    gistToken: '',
    publishEndpoint: '',
    // 腾讯文档全自动粘贴（CDP 受信按键；开关在设置页请求/移除 debugger 可选权限）
    txdocsAutoPaste: false,
    // 更新检测
    updateCheckEnabled: true,
    updateCheckIntervalHours: 6,
    updateGithubToken: '',
  };

  // 把原始 storage 值归一化成「content 侧要用的 cfg 视图」。
  // 吸收原 background.js getConfig 分支里的手工整形（含 publishConfigured 计算）。
  // 只读、纯函数：传入 storage.get 的结果，返回内容脚本消费的规整对象。
  function normalizeConfig(c) {
    c = c || {};
    const publishConfigured =
      (c.publishTarget === 'gist' && !!c.gistToken) ||
      (c.publishTarget === 'custom' && !!c.publishEndpoint) ||
      (c.publishTarget === 'cloudbase' && !!c.publishEndpoint);
    return {
      hasKey: !!c.apiKey,
      translateDefault: c.translateDefault !== false,
      autoHotDefault: c.autoHotDefault !== false,
      autoHotN: c.autoHotN || 10,
      cardTheme: c.cardTheme || 'follow',
      cardStyle: c.cardStyle === 'reading' ? 'reading' : 'native',
      cardRatio: c.cardRatio || 'smart',
      cardShowEng: c.cardShowEng !== false,
      cardShowTime: c.cardShowTime !== false,
      cardShowFooter: !!c.cardShowFooter,
      redactEnabled: !!c.redactEnabled,
      redactMode: c.redactMode || 'rules',
      redactTerms: c.redactTerms || '',
      redactPII: !!c.redactPII,
      redactImages: !!c.redactImages,
      publishTarget: c.publishTarget || 'none',
      publishConfigured,
    };
  }

  XS.DEFAULTS = DEFAULTS;
  XS.normalizeConfig = normalizeConfig;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DEFAULTS, normalizeConfig };
  }
})();
