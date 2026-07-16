# X 转发卡片

一个 Chrome/Edge 浏览器扩展：在 x.com（或旧域名 twitter.com）的推文页，一键把推文（含中文翻译和你勾选的评论）生成一张排版干净的**双语长图**或一个**自包含网页**，转发到微信发给国内的朋友。

功能一览：

- **双语长图（新版「无痕 Seamless」）**：主推文 + 引用 + 勾选评论，原文/译文对照，复制即可粘贴到微信。长图**跟随 X 当前主题**（浅色/暗蓝/纯黑，也可固定），默认走 **X 原生截图风**皮肤——蓝勾徽章、X logo、原生翻译标签「已翻译自 英语」+ 纯文本译文、原生中文时间「下午3:42 · 2026年7月15日」、互动行，力求「就是一张 X 详情页截图」；另可在操作栏切回**阅读排版风**（蓝边译文块、大字号，适合长文/公众号）。
- **默认自动选热门评论**：进入选择模式即按点赞/转推/回复的热度自动选出前 N 条（默认 10，可在设置/操作栏改，改动会记住），之后仍可手动增减；可在设置里关掉改为纯手动。
- **生成网页 / 复制图文**：导出自包含单文件 HTML（图片内联、原文/译文切换、移动端友好）；或一键「复制图文」，直接粘贴进公众号 / 语雀 / 飞书 / 腾讯文档 / 印象笔记，由平台生成链接——免服务器、免备案、微信最友好。
- **发布到腾讯文档（无感发布，三级降级）**：网页预览里一键打开 `docs.qq.com`，右下角向导自动推进——优先把推文构造成 .docx **自动导入**（服务端转换、排版最佳、零手动）；不成再试 **CDP 受信粘贴**（需在设置页开启「腾讯文档全自动粘贴」调试权限）；最后退到**引导式手动粘贴**（按一次 ⌘V）。随后自动设为「任何人可查看」并取回链接——免服务器免备案、微信内打开最友好（需登录腾讯文档）。
- **敏感内容打码**：可选按规则（本地正则）或模型（LLM）屏蔽敏感文字，并给图片打马赛克；操作栏会标明当前是「规则」还是「模型」模式，生成后回报打了几处（规则模式没填词表会明确提示未改动，不再静默无效）。
- **GitHub 更新检测**：定时检查 main 分支最新版本，发现新版时在扩展图标显示 `NEW`，并可在设置页手动检查。
- **X Articles 基础支持**：识别长文专用的标题/正文容器并提取，避免只生成配图、不带正文；仍不追求正文与图片的精确穿插（见「已知限制」）。

没有服务器、没有账号体系，抓取与渲染都发生在你自己的浏览器里；唯一的外部依赖是 DeepSeek API（可选，用于翻译和「模型打码」）。

## 新版外观「无痕 Seamless」（v0.4.0）

设计目标见 `design/总设计构思稿.md` 与 `design/设计呈现_opus48.html`：产出图**向外像一张 X 原生截图**、插件 UI **向内像 X 官方功能**。设计稿排期 P0–P3 已全部落地（分页裁切除外）：

**向外（成图）**
- **主题跟随**：生成时读 `getComputedStyle(document.body)` 判定当前 X 主题（浅色/暗蓝 `#15202B`/纯黑），长图与网页随之着色，也可固定。深色卡片默认加 1px 描边，防在微信白底聊天里边界消融。
- **两套卡片皮肤**：`native` X 原生截图风（默认）——蓝勾徽章、X logo、原生翻译标签 + 纯文本译文、原生中文时间「下午3:42 · 2026年7月15日」、互动行（1.2万 格式）；`reading` 阅读排版风——蓝边译文块、更大字号。**水印已全面移除**（「落款」原文行默认关，可在成图控制台打开）。
- **比例预设**：智能长图（默认）/ 4:5 / 1:1 / 3:4 / 9:16——固定比例下内容不足按视觉重心（略偏上）补背景色；内容超出则**裁图不裁文**：按阶梯（1→0.7→0.5→0.35）逐级压缩图片/视频封面高度、文字与结构不动，直到卡片装进目标比例；压到最小仍超出才退回智能长图并提示（分页裁切在路线图）。

**向内（页面 UI，恒跟随 X 主题）**
- FAB 换成 X compose 同款 56px 圆钮；操作栏变成跟随主题的工具条（火焰 SVG + 步进器 + X 开关 + 胶囊按钮，「生成网页」降白底描边次级）；勾选改 22px 圆圈（左上角避开 ⋯）；弹窗长成 X Dialog（✕ 左上、主按钮右上、scale .95→1 入场）；Toast 蓝底白字自底部升起；全面清除 emoji 控件；动效尊重 `prefers-reduced-motion`。
- **成图控制台**：长图预览弹窗内直接切换 比例/主题/样式/显示（互动数据·时间·落款），改动即重渲染，选择全部记忆。
- **零摩擦通道**：`⌥ + 点击 FAB` 或 `Shift+S`（详情页）→ 跳过选择与预览，按上次配置直接生成主推文长图进剪贴板 + Toast「已复制」。
- **分享菜单注入（best-effort）**：X 自己的分享下拉菜单里追加「以图片分享」一行（克隆现有菜单项换文案图标，样式原样继承）；X 改版失效时静默消失，FAB 与快捷键不受影响。
- 下载文件名用 iPhone 风格 `IMG_XXXX.PNG`。

> **需在真实 Chrome 里回归的项**（node 单测 133 例覆盖纯逻辑，下列依赖真实浏览器/DOM）：
> 1. **长图渲染**：html2canvas 对内联 **SVG 图标**（蓝勾/X logo/互动图标）的栅格化——最需要肉眼确认的一处；异常先看 `chrome://extensions` 的 content 脚本报错。
> 2. **页面 UI 主题跟随**：在 X 里切换 浅色/暗蓝/纯黑，确认 FAB/操作栏/弹窗/Toast 配色实时跟随。
> 3. **成图控制台**：改比例/主题/样式/显示各一次，确认预览即时刷新且选择被记住；4:5 等固定比例下确认补白居中略偏上。
> 4. **固定比例下图片阶梯压缩（裁图不裁文）生效**：一条图多/正文长的推文切到 4:5 或 1:1，确认图片/视频封面被压小而文字完整，卡片装进目标比例（压到最小仍超出才提示回退智能长图）。
> 5. **FAB 在左下、不与私信抽屉重合**：宽窗口/窄窗口各看一次，确认蓝色圆钮在左下角、不被 X 右下的私信抽屉或 compose 圆钮遮挡。
> 6. **腾讯文档粘贴排版正常（无碎版）**：生成网页→「复制图文」→粘贴进腾讯文档，确认名字行/正文/译文/图片/引用（blockquote）/评论分隔正常，无行内大方块头像、无裸文本碎版。
> 7. **零摩擦通道**：⌥点击 FAB 与 Shift+S 各试一次（<2 秒进剪贴板）。
> 8. **分享菜单注入**：点推文分享图标，看菜单里是否多出「以图片分享」；没有也不算故障（属 best-effort，X 菜单 DOM 易变）。
> 9. **蓝勾徽章**：认证账号推文确认 `icon-verified` 选择器命中；金/灰徽章判定为 best-effort。
> 10. **网页主题**：三主题各「生成网页 → 新标签预览」确认着色。
> 11. **腾讯文档导入路径**：生成网页 →「发布到腾讯文档」，在 `docs.qq.com` 确认向导走「导入文档→设权限→取链接」三步流、显示「已自动导入」、文档里图片纵横比正确（首次接线后建议在 Word/WPS 里也开一次该 docx，目检边框/缩进观感）；导入 20s 未走通应自动降级为粘贴流程，且不产生重复导入。
> 12. **腾讯文档 CDP 受信粘贴**：设置页开启「腾讯文档全自动粘贴」授权 debugger 后，走粘贴路径确认向导显示「已自动粘贴」且内容真实注入（顶部调试横幅短暂出现属预期）；对已开 DevTools 的标签应 attach 失败并退到手动引导。

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

### 4.（可选）检查更新

设置页的「更新检测」会每隔约 6 小时读取 GitHub 上 main 分支的 `manifest.json` 版本号，并展示最新提交。若 GitHub 版本高于当前扩展版本，工具栏图标会显示 `NEW`。公开仓库无需配置；若 GitHub API 返回 404/403，可在设置页填写一个只具备仓库读取权限的 GitHub Token。

> Chrome 不允许解压安装的扩展自己从 GitHub 下载并执行新代码；因此本功能只负责提醒。更新源码仍需在本仓库目录执行 `git pull`，然后到 `chrome://extensions/` 点扩展卡片上的「刷新」。

### 5.（可选）打包分发

要把扩展发给别人，或上传 Chrome 应用商店，用打包脚本生成 zip：

```bash
bash scripts/package.sh          # 产物：dist/x-share-v<版本>.zip
```

脚本从 `manifest.json` 读版本号，只收集运行必需的文件（`manifest.json`、`LICENSE`、`README.md`、`icons/`、`src/`、`vendor/`）。对方拿到 zip 后解压，按上面第 2 步「加载已解压的扩展程序」即可。

## 使用

1. 在 x.com / twitter.com 打开任意一条**推文详情页**（URL 里带 `/status/`）
2. 点击右下角的「📤 生成转发卡片」悬浮按钮，进入选择模式
3. 选评论，两种方式任选：
   - **默认自动选热门**：进入选择模式扩展会自动向下滚动加载评论、按热度排序、选出前 N 条（框里可改 N，默认 10，会记住）；不想要可在设置里关掉
   - **手动**：点击想带上的评论即可勾选（再点取消，最多 20 条），或点操作栏「🔥 自动选热门」重选
4. 操作栏勾选「附中文翻译」「敏感打码（规则/模型）」（是否默认勾选在设置里配），点：
   - **生成长图** → 预览里「复制图片 / 下载 PNG」
   - **生成网页** → 预览里「复制图文（粘贴到公众号/文档）/ 发布到腾讯文档（自动导入优先，三级降级）/ 新标签预览 / 下载 HTML / 发布并复制链接」
5. 去微信粘贴图片，或把「图文」粘进公众号/文档、转发网页链接；或点「发布到腾讯文档」按右下角向导产出 `docs.qq.com` 链接

内容：主推文（双语对照）、图片（最多 4 张）、引用推文、视频封面（含提示）、勾选的评论（同样双语、附热度数字）、底部原文链接和时间。

## 生成网页 / 复制图文 & 链接托管（重要取舍）

「生成网页」永远会产出一个**自包含单文件 HTML**（图片内联、离线可开）。难点在「怎么变成一个中国大陆能打开、且发微信不被拦的链接」——这是本项目结构性最难的一环。调研结论：**没有「免费+匿名+零运维+境内稳定+微信不封」五者兼得的方案**（微信会拦截未备案/境外 IP/新域名的外链；国内 OSS 默认域名对 HTML 强制下载；解析到境内服务器的域名要备案）。因此按优先级：

| 发布方式 | 说明 | 大陆可访问 / 微信友好 |
|---|---|---|
| **复制图文**（推荐） | 一键复制带内联图片的富文本，直接**粘贴进公众号后台 / 语雀 / 飞书 / 腾讯文档 / 印象笔记**，由平台用自家已备案域名生成链接 | ✅ 免服务器、免备案、微信最友好（公众号可能丢弃内联图片，需在其编辑器重传） |
| **发布到腾讯文档**（无感发布） | 点一下打开 `docs.qq.com`，右下角向导按「三级降级」自动推进（见下），最终设为「获得链接的任何人可查看」并自动取回 `docs.qq.com` 链接 | ✅ 免服务器、免备案、微信最友好；需登录腾讯文档，最坏情况手动粘贴一次 |

> **「发布到腾讯文档」的三级降级**（自动优先、失败逐级退；右下角向导会标明当前用的是哪一级——「已自动导入」/「已自动粘贴」/「请手动粘贴」）：
>
> 1. **自动导入 .docx（首选，排版最佳）**：扩展在本地把推文构造成最小合法 .docx（`emit-docx` 发射 OOXML、`zipdocx` 打 ZIP 包，含内联图片与真实纵横比），投给 `docs.qq.com/desktop` 的导入入口（`input[type=file]`），由腾讯文档**服务端**转换成在线文档——零手动、不依赖剪贴板。导入 20 秒内没走通自动降到下一级。
> 2. **CDP 受信粘贴（需开启开关）**：设置页勾选「腾讯文档全自动粘贴」（首次会请求可选的 `debugger` 权限）后，后台经 `chrome.debugger` 对文档页发**真实 ⌘V/Ctrl+V**（`isTrusted=true`），绕过 canvas 自绘编辑器对合成事件的过滤。粘贴瞬间顶部会短暂出现「正在调试此浏览器」横幅，属预期；粘贴的是当下系统剪贴板内容（向导调用前会重写一次剪贴板）。已开 DevTools 的标签会 attach 失败，自动退到下一级。
> 3. **引导式手动粘贴（兜底，永远可用）**：图文在点「发布到腾讯文档」时已写入剪贴板，向导提示用户点正文区按一次 ⌘V。粘贴排版已针对该编辑器改为扁平块级结构（`<p>`/`<blockquote>`/`<img>`，无嵌套 div 与 border-radius），避免碎版。
>
> 之后的「设为任何人可查看 → 取回链接」各步不分级，一律自动优先、失败退成可视化引导。真正的后台 API 直发需要腾讯文档 **OpenAPI + 自建后端换 `access_token`**（见下方路线图条目），在三级降级已够用的前提下暂不引入。
| **下载 HTML / 新标签预览** | 零依赖，永远可用；自己决定怎么发 | — |
| **自定义服务器**（设置里选） | POST `{html}` 到你的端点，期望返回 `{url}` | ✅ 用**香港轻量服务器**或**腾讯云 CloudBase**（免备案默认域名 / HTTP 函数）即可，是自控的境内正解 |
| **GitHub Gist**（设置里选） | 一个带 token 的 API 调用自动发布，返回 `gistpreview.github.io` 链接 | ❌ github.io 在大陆多被墙、微信常拦，仅适合**非墙内接收者 / 存档** |

> **评估结论**：给国内朋友、尤其发微信，**首选「复制图文」**（借平台托管）或**图片**（最稳）。要「自己的链接」就走「自定义服务器 / CloudBase」——仓库已附可直接部署的 `server/cloudbase-publish/` 云函数（协议 `POST {html}` → `{url}`）；Gist 只作境外/存档用。自定义端点需在 `manifest.json` 的 `host_permissions` 里加上该域名再刷新扩展（`*.tcloudbase.com` 已预置）。
>
> **为什么不接「用户登录语雀/飞书/印象笔记/公众号」**：专门调研过——这些平台都无法免费、免登录、经 API 一键产出「大陆可访问」链接（语雀免费版已砍公开分享、飞书文档链接微信内被封、印象笔记 CN 版公开页要登录、公众号需认证企业主体）。凡是能出大陆可访问链接的路子最终都要一台自建后端，故直接用 CloudBase 最省事、最自控。

## 敏感内容打码

用于避免把 X（政治敏感平台）内容转到微信时触发审核/封号。在设置页开启，两种文字模式：

- **规则匹配（默认）**：本地正则，快、免费、离线。**词表需你自己填**——本扩展不内置任何政治敏感词；普通词按字面屏蔽，`/pattern/flags` 按正则。可另外勾选屏蔽手机号/邮箱/长数字等个人信息。命中处用 █ 覆盖。
- **模型匹配**：把文本交给 DeepSeek 智能识别并打码（需 API Key；被改写的句子会失去链接高亮）。

可另外勾选「给图片打马赛克」，对配图做像素化处理。

## 已知限制

- **X Articles（长文）的图片目前沿用普通推文布局**：正文（标题+全文）会被完整提取，但图片仍按扁平顺序排在正文之后，不追求跟正文段落精确穿插；完整长文排版更推荐用「生成网页」。若长文专用容器找不到（X 改版），会退到「有 lang 属性的可见文本节点」兜底提取
- **视频**只渲染封面帧 + 提示语，观看需打开原文链接（二期的 GraphQL 方案会取到可播放地址）
- **自动选热门**只能评估「已加载出来的」评论：X 是虚拟滚动，扩展会自动向下滚动加载一批再排序，但不会滚到底；热度取自评论操作栏的点赞/转推/回复数字
- 长推文若在时间线上被折叠，请先进入详情页并展开全文再生成
- 主推文识别依赖 X 的 DOM 标记（`tabindex="-1"`），若识别错误，直接点开目标推文自己的详情页再操作
- X 前端改版可能导致提取失效，症状是「推文解析失败」——此时需要更新 `src/content/extract.js` 里的选择器，或等二期的 GraphQL 响应拦截方案
- 手动勾选的评论按勾选顺序排列；自动选的按热度从高到低排列
- 敏感打码是**辅助**手段，不保证覆盖所有敏感内容，最终仍需你自己把关

## 项目结构

```
manifest.json               MV3 清单（content_scripts 的加载顺序是依赖声明，勿乱动）
LICENSE                     MIT 许可证
scripts/package.sh          打包成可分发 zip
vendor/html2canvas.min.js   第三方：DOM 逐元素栅格化（MIT）
src/shared/                 两栖纯逻辑模块（globalThis.__XS + module.exports，三端共享、node 可测）
  config-schema.js          DEFAULTS 唯一来源 + 配置归一化（normalizeConfig）
  fmt.js                    esc / fmtDate / fmtTimeNative / formatCountCN / parseCount / needsTranslation / 字母头像 / buildTitle
  theme.js                  主题 token 系统：三主题(light/dim/lightsout) + 读页面背景判定当前 X 主题
  ratio.js                  比例引擎：智能/4:5/1:1/3:4/9:16 补白计划（视觉重心略偏上，不缩放）
  blocks.js                 有序块模型：blocksOf / blockPhotos / segments 聚合
  ir.js                     payload → RenderIR（唯一一次语义遍历：blocks 兜底、译文位置、引用递归）
  rpc.js                    content 侧消息信封 + 具名方法（getConfig / fetchImages / translate / redact / publish / canTrustedPaste / trustedPaste）
  cdp.js                    CDP 受信按键序列（腾讯文档全自动粘贴的 ⌘V/Ctrl+V 参数构造，纯逻辑）
  zipdocx.js                DOCX 容器引擎：零依赖 ZIP(STORE)/OPC 打包（crc32 / buildZip / docxFromXml / dataUrlToBytes / bytesToBase64）
src/background.js           后台：importScripts(shared) + 表驱动 handler；翻译 / 模型打码 / 发布 / 更新检测 / 批量抓图
src/content/extract.js      DOM 提取 + 热度解析（data-testid 锚点，改版时先查这里）
src/content/redact.js       敏感内容打码：规则正则、PII、图片像素化
src/content/render/         五个哑发射器 + 栅格化（只对 IR 节点 switch，只管样式不管语义）
  emit-card.js              IR → 内联样式 DOM（html2canvas 输入；x.com CSP 约束，全走 CSSOM）。
                            双皮肤：native「X 原生截图风」(默认) / reading「阅读排版风」，均由 theme token 驱动
  emit-page.js              IR → 自包含网页 HTML
  emit-rich.js              IR → 「复制图文」富文本片段
  emit-text.js              IR → 纯文本兜底
  emit-docx.js              IR → OOXML document.xml + media 清单（腾讯文档「导入路径」的 .docx 主体）
  raster.js                 卡片 DOM → html2canvas → PNG Blob
src/content/ui/widgets.js   页面内 UI 组件：fab / 操作栏 / 弹窗 / 遮罩 / toast / 预览
src/content/pipeline.js     生成管线：批量抓图内联 → 翻译 → 打码克隆（纯数据进出，经 rpc 走后台）
src/content/content.js      仅编排：状态 + 事件接线（选择模式、自动选热门、成图控制台、零摩擦通道）
src/content/share-menu.js   分享菜单注入「以图片分享」（best-effort，克隆 X 菜单项，失败静默）
src/content/txdocs.js       腾讯文档无感发布状态机（仅 docs.qq.com 注入；docx 导入 / CDP 受信粘贴 / 手动引导三级降级）
src/content/content.css     页面内 UI 样式
src/options/options.html    设置页（先引 shared/config-schema.js 再引 options.js）
src/options/options.js      设置页逻辑：读写 chrome.storage、测试翻译
test/                       node 内置 node:test 零依赖单测（config / fmt / blocks / ir / redact / 渲染金样）
icons/                      扩展图标
server/cloudbase-publish/   境内可访问链接的发布端（CloudBase 云函数，POST {html}→{url}）
```

**内容脚本加载顺序是生命线**（见 `manifest.json`；本项目无构建、无模块系统，依赖全靠 `window.__XS` 命名空间 + 加载顺序满足）：

```
vendor/html2canvas.min.js
→ src/shared/（config-schema → fmt → theme → ratio → blocks → ir → rpc → zipdocx，纯逻辑；ir 依赖 blocks、emit-card 依赖 theme）
→ extract.js / redact.js（数据层，依赖 shared/fmt、shared/blocks）
→ render/emit-*.js + raster.js（渲染层，依赖 shared/ir、shared/fmt）
→ ui/widgets.js + pipeline.js（widgets 依赖 shared/rpc、shared/fmt、emit-docx、shared/zipdocx；pipeline 依赖 shared/rpc、redact.js）
→ content.js（编排层，依赖以上全部）
```

docs.qq.com 侧另有一条独立注入链（同样「被依赖者在前」）：`shared/fmt → shared/rpc → shared/zipdocx → content/txdocs.js`；后台 service worker 经 `importScripts` 引 `shared/config-schema.js` 与 `shared/cdp.js`。

顺序错误 = 白屏级故障。新增文件时按「被依赖者在前」插入对应位置。

跑单测（只用 node 内置模块，零 npm 依赖）：

```bash
node --test test/
```

## 第三方与许可

本项目以 [MIT 许可证](LICENSE) 开源。

捆绑 [html2canvas](https://html2canvas.hertzen.com) 1.4.1，Copyright (c) 2022 Niklas von Hertzen，MIT 许可证；完整许可证文本保留在 `vendor/html2canvas.min.js` 文件头。

## 路线图（对应方案文档二期）

- [x] 自动筛选热门评论
- [x] 生成可打开的网页（自包含 HTML）+ Gist / 自定义端点发布
- [x] 敏感内容屏蔽 / 图片打码
- [ ] GraphQL 响应拦截：更稳的数据源，拿到各码率视频地址（网页里可播放视频）
- [x] 附一个可直接部署的发布端示例（`server/cloudbase-publish/`，CloudBase 云函数，配合「自定义服务器 / CloudBase」）
- [x] 腾讯文档（引导式半自动）发布：免服务器免备案、微信内打开最友好；复用已登录会话，用户手动粘贴一次，其余（新建/设权限/取链接）自动优先、失败退成可视化引导
- [x] 腾讯文档无感发布 v2（v0.5.0）：.docx 自动导入（emit-docx + zipdocx，服务端转换、排版最佳）→ CDP 受信粘贴（可选 debugger 权限）→ 引导式手动粘贴，三级降级
- [ ]（可选，二期）腾讯文档 OpenAPI 发布目标：可做到全自动，但需自建后端换 token + 应用审核；已被上面的三级降级替代，仅在需要绝对零手动时再评估
- [x] X Articles 基础长文提取（标题 + 正文；图片暂不与正文精确穿插，见「已知限制」）
- [x] 卡片样式可选（X 原生风 / 阅读排版风）+ 长图/网页跟随 X 三主题（「无痕 Seamless」v0.3.0）
- [x]（无痕 P1–P3，v0.4.0）页面内 UI 全面原生化（compose 圆钮 / X 工具条 / 22px 勾选圈 / X Dialog / 蓝 Toast / 零 emoji / reduced-motion）；成图控制台（比例·主题·样式·显示，即改即渲染）；比例预设与补白引擎；零摩擦通道（⌥FAB / Shift+S）；分享菜单注入「以图片分享」（best-effort）；去水印；IMG_XXXX.PNG 文件名
- [ ]（无痕后续）分页裁切（行盒吸附、切点落推文/段落边界）；仿真 iPhone 截图模式（393pt@3x）；离屏(offscreen)渲染替代页内 html2canvas；设置页 X 风格重排
