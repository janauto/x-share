// content 侧消息薄封装：把散落各处的 chrome.runtime.sendMessage + 各自的
// try/catch + error 判断三件套收敛成统一信封 + 具名方法。
//
// 信封：
//   成功        -> { ok: true, ...data }         （data 展开在顶层，便于取 translations/url 等）
//   API 返回错误 -> { ok: false, error }           （后台 handler 返回的 { error } / 'NO_KEY'）
//   传输层抛错   -> { ok: false, transport: true, error }
//   空响应       -> { ok: false }                   （error 缺省，调用方用 '未知错误' 兜底）
//
// transport 标志保留是为了「行为零变化」：翻译/屏蔽失败时，原代码对
// 「sendMessage 抛错」与「后台返回 error」给的是不同文案，这里靠它区分。

(() => {
  const XS = (globalThis.__XS = globalThis.__XS || {});

  async function send(msg) {
    let resp;
    try {
      resp = await chrome.runtime.sendMessage(msg);
    } catch (e) {
      return { ok: false, transport: true, error: String((e && e.message) || e) };
    }
    if (!resp) return { ok: false };
    if (resp.error) return { ok: false, error: resp.error };
    return { ok: true, ...resp };
  }

  const rpc = {
    // 归一化后的 content 侧 cfg（后台用 normalizeConfig 整形），无有意义错误路径
    getConfig: () => chrome.runtime.sendMessage({ type: 'getConfig' }),

    // 批量抓图：一条消息多 URL，逐 URL 失败填 null，不让单张失败拖垮整批。
    // 返回 { ok, dataUrls } | { ok:false, ... }
    fetchImages: (urls) => send({ type: 'fetchImages', urls }),

    // 返回 { ok, translations } | { ok:false, error/transport }
    translate: (texts) => send({ type: 'translate', texts }),

    // 返回 { ok, redacted } | { ok:false, error/transport }
    redact: (texts) => send({ type: 'redact', texts }),

    // 返回 { ok, url, rawUrl? } | { ok:false, error/transport }
    publish: (html) => send({ type: 'publish', html }),
  };

  XS.rpc = rpc;
})();
