# 金山文档（WPS 开放平台）个人版 API 验证 harness 说明

配套脚本：[`kdocs-api-test.mjs`](./kdocs-api-test.mjs)（Node 18+，零依赖，用原生 `fetch`）。

目的：等你在 open.wps.cn 注册拿到凭证后，一条命令验证三大未知点：

1. 换 / 刷新 token 是否强制后端 → **TK-05**（结论见文末，已由官方文档证实）
2. 能否创建分享并设为「任何人可查看」→ **TK-03**
3. 上传 / 创建的文档内容如何呈现 → **TK-02** 创建 + **TK-04** 匿名访问观察

---

## 一、在 open.wps.cn 注册与建应用（拿凭证）

> 文档域名 `developer.kdocs.cn` 与开放平台门户 `open.wps.cn` 属同一套 WPS 开放平台。门户注册、文档看 developer.kdocs.cn。

大致路径（以平台实际界面为准，若入口调整按页面导航走）：

1. 打开 **https://open.wps.cn/** ，用微信 / 手机号登录。
2. 进入 **控制台 / 开发者中心**，完成 **个人开发者** 实名认证（个人版即选个人开发者）。
3. **创建应用**：填应用名称、回调地址 `redirect_uri`（OAuth 授权回调，可先填一个你能接收的 URL，如本地 `http://localhost:xxxx/callback`）。
4. 创建后在应用详情页拿到两把凭证：
   - **`app_id`**（应用 ID）
   - **`app_key`**（应用密钥，即 APPKEY —— 高敏感，勿放前端）
5. 为应用勾选 / 申请所需 **scope 权限**，至少包含：
   - `user_basic`（获取用户基本信息，TK-01 要用）
   - 个人文档读写 / 分享相关 scope（创建文档、上传、创建分享、删除所需；具体 scope 名以应用后台可勾选项为准）。

### 从 app_key 换 access_token（这一步官方要求在服务端做）

harness **不替你做这一步**（它需要 app_key，属服务端职责）。你需要在服务端跑一遍标准 OAuth：

1. **授权**：把用户导向
   `https://developer.kdocs.cn/h5/auth?app_id={app_id}&scope={逗号分隔的scope}&redirect_uri={URL编码后的回调}&state={自定义}`
   用户同意后回调到 `redirect_uri?code={code}&state=...`（`code` 有效期 5 分钟）。
2. **换令牌**（GET）：
   `GET https://developer.kdocs.cn/api/v1/oauth2/access_token?code={code}&app_id={app_id}&app_key={app_key}`
   返回 `{ code:0, data:{ access_token, refresh_token, expires_in, app_id } }`（access_token 有效期 24h，refresh_token 90 天）。
3. 把拿到的 `access_token` 填进环境变量喂给 harness。

> 文档：[授权（Web）](https://developer.kdocs.cn/common/authorization/web.html)

---

## 二、环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `KDOCS_ACCESS_TOKEN` | 是 | 上面 OAuth 换来的 access_token。不填则所有联网用例记 **BLOCKED**。 |
| `KDOCS_PROBE` | 否 | 创建文档探测方式：`both`（默认，先试创建空白，失败再试上传）、`create`（只创建空白）、`upload`（只上传文本文件）。 |

---

## 三、运行命令

```bash
cd /Users/linxiansheng/工作/CODE/x-share

# 只做语法检查（无需凭证）：
node --check scripts/kdocs-api-test.mjs

# 有凭证后实际验证：
KDOCS_ACCESS_TOKEN=你的access_token node scripts/kdocs-api-test.mjs

# 只测上传路径：
KDOCS_ACCESS_TOKEN=xxx KDOCS_PROBE=upload node scripts/kdocs-api-test.mjs
```

脚本会逐用例打印 `PASS / FAIL / BLOCKED`，结尾输出汇总表；有 FAIL 时退出码为 1。请求返回 4xx 时会打印服务器原始 `code / msg / body` 帮你定位是哪个参数不被接受。

---

## 四、五个用例分别验证什么

| 用例 | 验证内容 | 依据的官方文档 |
|------|----------|----------------|
| **TK-01** | 凭证有效性：`GET /user/basic` 取用户信息，能拿到 nickname / open_id 即凭证有效 | [获取用户信息](https://developer.kdocs.cn/server/user/userinfo.html) |
| **TK-02** | 创建文档：两条路都探并记录哪种可用——(A) 创建空白 `.docx`；(B) 上传一个小 `.txt`。返回体的 `data.id.open_id` 即后续 `:file_token`。**顺带用于观察 TK-04 里内容呈现方式** | [创建空白文档](https://developer.kdocs.cn/server/personal/create-files.html) · [上传本地文档](https://developer.kdocs.cn/server/personal/upload-local-files.html) |
| **TK-03** | 创建分享并设「任何人可查看」：`range:"anyone"` + `permission:"read"` + `status:"open"`；打印服务器实际接受的参数与返回的 `link_url` / `sid`。冲突时自动带 `reset:true` 重试 | [创建分享](https://developer.kdocs.cn/server/personal/create-links.html) |
| **TK-04** | 匿名验证：对 `link_url` 做**无凭证** `fetch(redirect:'follow')`，断言 HTTP 200、最终 URL 不是登录 / 授权页、能抓到页面 `<title>`；如实打印最终 URL、title、是否疑似登录页 | 同 TK-03 返回的链接 |
| **TK-05** | 前端可行性判定（纯静态，不发请求）：直接给出「换 / 刷新 token 是否必须后端」的结论 + 官方引文 + URL | [授权（Web）](https://developer.kdocs.cn/common/authorization/web.html) |

**分享参数枚举（来自创建分享文档）**：

- `range`：`"anyone"`（任何人）—— 控制「谁能访问」。
- `permission`：`"read"`（浏览）/ `"write"`（编辑）。
- `status`：`"open"`（默认，任何人可见）/ `"close"`（仅指定协作人）。
- `ext_perm_list`：可选，`["comment"]`（评论）。
- `period`：可选，`0`（永久）/ `7` / `30`（天）。
- `reset`：可选，`true` / `false`（是否重置已有分享）。

「任何人可查看」= `range:"anyone"` + `permission:"read"` + `status:"open"`。

**清理**：脚本结束会用 `DELETE /personal/files/:file_token`（[将文档移动到回收站](https://developer.kdocs.cn/server/personal/delete-files.html)）把测试文档移入回收站；若自动删除失败，会打印 `file_token` 提醒你手动删。

---

## 五、关键结论：换 token 必须后端（已由官方文档证实）

**结论：是。** 换 / 刷新 access_token 官方明确要求「必须从服务器调用接口」，纯前端扩展做不了这一步。

> **官方原文**（[授权（Web）](https://developer.kdocs.cn/common/authorization/web.html) 「第二步：获取令牌」的「提示」）：
>
> 「由于应用 `appkey` 和获取到的 `access_token` 安全级别比较高，后续刷新 `access_token`、通过 `access_token` 获取用户信息等步骤，**必须从服务器调用接口**。」

对 x-share 的含义：

- 纯前端 Chrome 扩展**不能**安全持有 `app_key`，也就不能自己换 / 刷新 token。
- 需要一个**最小后端 / serverless**（云函数即可）代持 `app_key`，完成 OAuth 换 token，再把 `access_token`（或用于嵌入编辑的临时凭证）下发给扩展。
- 「获取用户信息」等业务接口官方同样归为「必须从服务器调用」，因此更稳妥的架构是：**所有带 access_token 的 OpenAPI 调用都走后端代理**，扩展只与你自己的后端通信。
- 附：临时凭证接口（`POST /api/v1/openapi/user/edit_token`，[获取临时凭证](https://developer.kdocs.cn/server/user/create-edit-token.html)）用于把编辑页嵌入 iframe，同样是服务端换取后下发给前端。

---

## 附：本 harness 用到 / 参考的接口清单

| 名称 | 方法 + 路径 | 文档 URL |
|------|-------------|----------|
| 获取用户信息 | `GET /api/v1/openapi/user/basic` | https://developer.kdocs.cn/server/user/userinfo.html |
| 创建空白文档 | `POST /api/v1/openapi/personal/files` | https://developer.kdocs.cn/server/personal/create-files.html |
| 上传本地文档 | `POST /api/v1/openapi/personal/files/upload` | https://developer.kdocs.cn/server/personal/upload-local-files.html |
| 创建分享 | `POST /api/v1/openapi/personal/files/:file_token/links` | https://developer.kdocs.cn/server/personal/create-links.html |
| 获取分享信息 | `GET /api/v1/openapi/personal/files/:file_token/links` | https://developer.kdocs.cn/server/personal/get-links.html |
| 修改协作用户权限 | `PUT /api/v1/openapi/personal/files/:file_token/links/members/:user_id` | https://developer.kdocs.cn/server/personal/links-update-member.html |
| 获取文档列表 | `GET /api/v1/openapi/personal/files` | https://developer.kdocs.cn/server/personal/files.html |
| 将文档移入回收站 | `DELETE /api/v1/openapi/personal/files/:file_token` | https://developer.kdocs.cn/server/personal/delete-files.html |
| OAuth 换令牌 | `GET /api/v1/oauth2/access_token` | https://developer.kdocs.cn/common/authorization/web.html |
| OAuth 刷新令牌 | `POST /api/v1/oauth2/refresh_token` | https://developer.kdocs.cn/common/authorization/web.html |
| 获取临时凭证 | `POST /api/v1/openapi/user/edit_token` | https://developer.kdocs.cn/server/user/create-edit-token.html |

> 注：文档在「创建 / 上传」返回体里给的是 `data.id.open_id`，而「创建分享 / 删除」路径参数写作 `:file_token`。二者对应关系文档未逐字点明（doc-gap），harness 运行时以 `open_id` 代入 `:file_token` 并观察端点是否接受——若被拒会打印服务器报文以便定位。
