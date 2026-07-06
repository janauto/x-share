# x-share 发布端 · 腾讯云 CloudBase 云函数

把「生成网页」产出的自包含 HTML 存进腾讯云 CloudBase，返回一个**中国大陆可访问、免登录**的公开链接。是本项目调研后**境内链接的首选后端**（平台笔记类如语雀/飞书/印象笔记/公众号都无法免费免登录一键出大陆可访问链接，详见项目根 README 的取舍表）。

协议与扩展「自定义服务器 / CloudBase」通道一致：

- `POST {html}` → 存储 → 返回 `{ "url": "https://.../publish?id=xxxx" }`
- `GET ?id=xxxx` → 以 `Content-Type: text/html` 回吐该 HTML（任何人可打开）

## 为什么用云函数而不是静态托管

CloudBase 默认静态托管域名自 2024-01 起对 `.html` **强制下载**（`Content-Disposition: attachment`），浏览器不预览而是下载。云函数自己返回 `text/html` 头即可绕过这个坑。

## 部署步骤

1. 开通[腾讯云 CloudBase](https://console.cloud.tencent.com/tcb)（有免费体验版），记下**环境 ID**（env-id）。
2. 控制台 →「数据库」→ 新建集合 **`xshare_pages`**（默认权限即可，读写都由云函数完成）。
3. 控制台 →「云函数」→ 新建函数（运行环境 Node.js 16/18）：
   - 上传本目录（`index.js` + `package.json`），或用 CLI：
     ```bash
     npm i -g @cloudbase/cli
     tcb login
     tcb fn deploy publish --dir . -e <env-id>
     ```
   - 函数名建议就叫 `publish`（决定 URL 路径）。
4. 给该函数开启 **「HTTP 访问服务」**，触发路径设为 `/publish`。得到访问地址形如
   `https://<env-id>.service.tcloudbase.com/publish`。
   - 若控制台有「集成响应 / integrated response」开关，请**打开**（本函数返回 `{statusCode, headers, body}`，需要集成响应模式才能自定义 `Content-Type`）。
5. （强烈建议，正式分享必做）在 CloudBase 给环境**绑定已备案自定义域名**，并在云函数**环境变量**里设
   `PUBLIC_BASE=https://你的已备案域名/publish` —— 这样返回的链接用你的域名，微信内可稳定打开、无「访问提示中间页」。

## 接入扩展

打开扩展设置页 →「网页发布后端」：

- **发布方式** 选「腾讯云 CloudBase」
- **发布端点地址** 填第 4 步的 HTTP 访问地址（或你的备案域名 `/publish`）
- 保存后，在「生成网页」预览里点「发布到 CloudBase 并复制链接」即可

`*.tcloudbase.com` 域名已预置在扩展的 `manifest.json > host_permissions`；换成自建域名时需把该域名也加进去再重新加载扩展。

## 说明与限制

- 图片：扩展已把推文图片内联成 base64 存进 HTML，**无需图床**，CloudBase 直接托管即可。
- 单页上限 5MB（云函数里可改）；无过期清理，按需自行在集合上加 TTL/定时清理。
- 公开页是**纯静态展示**、不回连任何 API，因此不涉及浏览器侧 CORS。
- 默认 `*.tcloudbase.com` 域名可先用于自测；微信内稳定免登录打开请务必完成「备案自定义域名 + PUBLIC_BASE」。
