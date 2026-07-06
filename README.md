# X 转发卡片

一个 Chrome/Edge 浏览器扩展：在 x.com（或旧域名 twitter.com）的推文页，一键把推文（含中文翻译和你勾选的评论）生成一张排版干净的**双语长图**，复制后直接粘贴到微信发给国内的朋友。

没有服务器、没有账号体系，一切都发生在你自己的浏览器里；唯一的外部依赖是 DeepSeek 翻译 API（可选，不填 Key 就生成纯原文卡片）。

## 快速构建 / 上手

本扩展是**纯 JavaScript，无需编译、无需 Node/构建工具**。所谓「构建」对浏览器扩展而言就是「加载源码目录」或「打包成 zip」两件事。

### 1. 获取代码

```bash
git clone https://github.com/janauto/x-share.git
cd x-share
```

### 2. 加载到浏览器（开发/日常使用）

1. 打开 Chrome，进入 `chrome://extensions/`（Edge 是 `edge://extensions/`）
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择本仓库根目录（含 `manifest.json` 的那一层）
4. 改了代码后，回到该页点扩展卡片上的「刷新」按钮即可生效

> 无需 `npm install`——`vendor/html2canvas.min.js` 已随仓库附带，直接就能跑。

### 3.（可选）配置翻译

点击工具栏里的扩展图标打开设置页，填入 DeepSeek API Key（在 [platform.deepseek.com](https://platform.deepseek.com) 创建），点「测试翻译」确认连通。
设置页还可改「API 地址」指向任意 OpenAI 兼容服务（换域名后需同步在 `manifest.json` 的 `host_permissions` 里加上该域名再刷新扩展）。

### 4.（可选）打包分发

要把扩展发给别人，或上传 Chrome 应用商店，用打包脚本生成 zip：

```bash
bash scripts/package.sh          # 产物：dist/x-share-v<版本>.zip
```

脚本从 `manifest.json` 读版本号，只收集运行必需的文件（`manifest.json`、`LICENSE`、`README.md`、`icons/`、`src/`、`vendor/`）。对方拿到 zip 后解压，按上面第 2 步「加载已解压的扩展程序」即可。

## 使用

1. 在 x.com / twitter.com 打开任意一条**推文详情页**（URL 里带 `/status/`）
2. 点击右下角的「📤 生成转发卡片」悬浮按钮，进入选择模式
3. 往下滚动评论区，**点击**想带上的评论即可勾选（再点一次取消，最多 12 条）
4. 底部操作栏确认是否「附中文翻译」，点「生成长图」
5. 预览弹窗里点「复制图片」（或「下载 PNG」），去微信里粘贴发送

卡片内容：主推文（双语对照）、图片（最多 4 张）、引用推文、视频封面（含提示）、勾选的评论（同样双语）、底部原文链接和时间。

## 已知限制

- **视频**只渲染封面帧 + 提示语，观看需打开原文链接（二期的「分享链接」模式会解决）
- 长推文若在时间线上被折叠，请先进入详情页并展开全文再生成
- 主推文识别依赖 X 的 DOM 标记（`tabindex="-1"`），若识别错误，直接点开目标推文自己的详情页再操作
- X 前端改版可能导致提取失效，症状是「推文解析失败」——此时需要更新 `src/content/extract.js` 里的选择器，或等二期的 GraphQL 响应拦截方案
- 评论在卡片里按你的勾选顺序排列

## 项目结构

```
manifest.json               MV3 清单
LICENSE                     MIT 许可证
scripts/package.sh          打包成可分发 zip
vendor/html2canvas.min.js   第三方：DOM 逐元素栅格化（MIT）
src/background.js           后台：DeepSeek 翻译、twimg 图片转 data URL（绕 CORS）
src/content/extract.js      DOM 提取（data-testid 锚点，改版时先查这里）
src/content/card.js         双语卡片构建（内联样式）+ html2canvas → PNG
src/content/content.js      主流程：悬浮按钮、评论勾选、生成与预览
src/content/content.css     页面内 UI 样式
src/options/options.html    设置页（API Key / API 地址 / 模型 / 默认翻译开关）
src/options/options.js      设置页逻辑：读写 chrome.storage、测试翻译
icons/                      扩展图标
```

内容脚本按此顺序加载（见 `manifest.json`）：`vendor/html2canvas.min.js` → `extract.js` → `card.js` → `content.js`。

## 第三方与许可

本项目以 [MIT 许可证](LICENSE) 开源。

捆绑 [html2canvas](https://html2canvas.hertzen.com) 1.4.1，Copyright (c) 2022 Niklas von Hertzen，MIT 许可证；完整许可证文本保留在 `vendor/html2canvas.min.js` 文件头。

## 路线图（对应方案文档二期）

- [ ] GraphQL 响应拦截：更稳的数据源，拿到各码率视频地址
- [ ] 分享链接模式：一键上传快照到香港小服务器，生成微信内可直接打开的网页（支持视频播放）
- [ ] X Articles 长文支持
- [ ] 卡片样式可选（X 原生风 / 阅读排版风）
