# StarBot Console

多用户、多机器人、可扩展的 QQ 官方机器人管理与开发平台。

## 已实现

- 邮箱注册/登录和可选 QQ OAuth 登录；密码使用 scrypt，登录会话使用 HttpOnly Cookie。
- 登录/注册限流、会话轮换、来源校验和管理员权限服务端校验。
- 免费版、专业版、团队版会员套餐；套餐定义机器人、插件安装和事件保留额度。
- 管理员可在控制台配置网站名称、标语、介绍、Logo、favicon、ICP备案号、网安备案号和版权信息。
- 管理员可维护月付、季付、年付价格，并配置易支付兼容网关、人工审核或开发沙箱；支付成功后自动发放并顺延会员有效期。
- 管理员可分配套餐、覆盖单用户机器人配额、调整角色并停用账号。
- 添加机器人时真实验证 AppID/Client Secret，并通过 `GET /users/@me` 自动读取 QQ 官方机器人名称；Secret 使用 AES-256-GCM 加密。
- 机器人默认使用 WebSocket，也可选择 QQ 官方 Webhook 接入。WebSocket 按官方建议分片数建立完整连接组，支持服务端 Intents 策略、Identify 频控、Heartbeat、ACK 超时、Resume、抖动退避和重启自动恢复。
- SQLite 或 MySQL 租约保证同一数据库中的同一机器人只有一个 Gateway 所有者，实例异常后可自动接管。
- Gateway 事件持久化到所选数据库，并按会员套餐自动清理过期记录。
- 支持单聊/群聊消息调试、JSON REST 请求台、原始 multipart 代理和 200MB 富媒体分片上传。
- 支持 QQ 官方 Webhook 接入：每个机器人提供不可猜测的回调地址，完成 Ed25519 challenge、签名校验和事件去重。
- 开发者使用 `sdk/plugin` 编写插件并构建 ZIP，导入后由平台管理项目、版本、机器人安装、动态配置、优先级、启停、KV 和运行记录。
- 托管插件在 QuickJS 中隔离运行，可异步读取受权限控制的 QQ OpenAPI 响应并继续业务逻辑，不接触机器人 Secret、宿主文件系统或任意网络。
- SDK 内置官方当前 34 个 OpenAPI 端点目录和通用同源请求；频道扩展及官方后续新增 REST 接口无需等待平台发版即可调用。
- 插件市场支持搜索分类、私有安装、开发者上架申请和管理员审核；内置官方关键词回复插件来自数据库，不是前端演示数据。
- 旧 `sdk/node` 长轮询远程应用接口保留为兼容能力，支持 HMAC、Nonce、防重放、事件租约和受控 OpenAPI。
- Radix UI + shadcn 风格响应式控制台，支持 240/64px 侧栏、移动抽屉和 reduced-motion。

## 本地启动

```powershell
cd D:\16493\Desktop\star-webBot
npm install
Copy-Item .env.example .env.local
npm run keygen
```

将 `npm run keygen` 输出写入 `.env.local` 的 `CREDENTIAL_ENCRYPTION_KEY`。首次启动时访问 `/setup`，安装向导会创建站点和第一个管理员，并提供 SQLite 与 MySQL 两种持久化方式。

```env
DATABASE_PATH=./data/starbot.db
CREDENTIAL_ENCRYPTION_KEY=32字节Base64密钥（也支持64位十六进制密钥）
```

启动：

```powershell
npm run dev
```

访问 [http://localhost:3000/setup](http://localhost:3000/setup) 完成首次安装。完成后，`/` 是公开官网，`/console` 是需要登录的管理控制台。

### SQLite 安装

在向导中选择 **SQLite** 并填写数据库文件路径即可。默认路径为 `./data/starbot.db`，适用于单机或单实例部署。

### MySQL 安装

先在 MySQL 8.0+ 中创建一个空数据库与具备建表权限的账号，然后在向导中选择 **MySQL**，填写主机、端口、用户名、密码、数据库名称以及 TLS 选项。向导会先测试连接，再创建表结构；密码只加密保存在 `starbot.database-config.json`，不会回显。

也可通过环境变量固定数据库提供方，固定后安装向导会显示只读配置：

```env
DATABASE_PROVIDER=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=starbot
MYSQL_PASSWORD=替换为数据库密码
MYSQL_DATABASE=starbot
MYSQL_SSL=false
```

使用 `DATABASE_PROVIDER=sqlite` 可固定 SQLite；不设置 `DATABASE_PROVIDER` 时，向导选择会持久化到与 SQLite 文件同目录的 `starbot.database-config.json`。可通过 `DATABASE_CONFIG_PATH` 覆盖该文件位置。

## 系统设置

使用管理员账号进入控制台，在“管理 -> 系统设置”完成以下配置：

- **站点**：网站名称、标语、介绍、Logo、favicon、ICP/网安备案和版权信息。
- **QQ 登录**：QQ 互联网站应用 AppID、App Secret 和回调地址。这里不是 QQ 机器人 AppID。
- **邮箱验证**：SMTP 服务、注册验证和验证码登录；保存配置后可向指定邮箱发送测试邮件。
- **会员支付**：支付开关、支付模式和渠道参数。
- **套餐与订单**：免费/专业/团队套餐额度与月、季、年价格，以及人工订单到账审核。

Logo 和 favicon 支持 PNG、JPEG、WebP，favicon 额外支持 ICO，单个文件最大 5MB。QQ App Secret 和支付密钥只加密保存在服务端，后台不会回显明文。

邮箱测试只使用最近一次保存的 SMTP 配置。测试邮件发送成功后再开启注册验证或验证码登录，避免公开认证流程因错误端口、授权码或 TLS 模式而不可用。

## QQ 登录

推荐在“系统设置 -> QQ 登录”中配置。也可通过以下环境变量作为首次部署兼容回退：

```env
QQ_LOGIN_APP_ID=你的AppID
QQ_LOGIN_APP_SECRET=你的AppSecret
QQ_LOGIN_REDIRECT_URI=http://localhost:3000/api/auth/qq/callback
```

未配置时，登录页会明确显示“QQ 登录未配置”，不会伪装成可用功能。

## 会员支付

普通用户在“账户 -> 会员与账单”选择专业版或团队版，并按月、季度或年度购买。订单价格始终由服务端套餐配置计算，客户端不能指定金额。

- **易支付兼容网关**：填写网关提交地址、商户 ID 和商户密钥。异步通知地址为 `https://你的域名/api/payments/epay/notify`，网关必须能从公网通过 HTTPS 访问；平台验签、核对订单金额后自动发放权益。
- **人工收款审核**：用户创建待支付订单并查看付款说明，管理员确认到账后发放权益。
- **开发沙箱**：创建订单后立即模拟支付成功，仅适合本地开发；生产环境会拒绝启用和使用沙箱支付。

续费从当前未过期会员的到期时间继续顺延；已到期会员从付款时间重新计算。到期后账号自动回退免费版额度，已创建机器人不会被删除，配额也不会降到当前已用数量以下。

## 插件开发

完整插件清单、SDK、权限和运行限制见 [docs/plugin-development.md](docs/plugin-development.md)。构建仓库示例：

```powershell
node sdk/plugin/build.mjs examples/hosted-plugin dist/hello-starbot.zip
```

启动平台后，在“插件中心 -> 导入插件包”上传 `dist/hello-starbot.zip`，然后安装到机器人、填写配置并启用。旧远程应用迁移说明也保留在同一文档末尾。

## 验证

```powershell
npm test
npm run lint
npm run build
npm run test:e2e
```

## QQ 官方 Webhook

机器人页会显示专属回调路径。生产部署后复制完整 HTTPS URL 到 QQ 开放平台，并选择需要的事件。平台会自动响应 `op=13` challenge，并验证后续 `X-Signature-Ed25519`。

Webhook 的事件订阅在 QQ 开放平台后台完成。WebSocket 仍需在 Identify 中发送 Intents；当前平台由服务端固定申请已授权的群聊与单聊事件，用户无需填写原始位图。

## 部署边界

同一主机上的多个 Node 进程可共享 SQLite Gateway 租约、插件安装和兼容远程应用事件租约。跨主机部署应选择 MySQL；不要共享 SQLite 网络文件。反向代理需允许最大 201MB 请求体。

系统设置中的显示时区默认按 `TZ`、`/etc/timezone`、Node 运行环境的顺序自动检测，也可由管理员填写 IANA 时区覆盖。Docker 部署应传入宿主 `TZ`，或将宿主 `/etc/localtime` 与 `/etc/timezone` 只读挂载到容器同名路径；不要在镜像内写死默认时区。

QQ OAuth 与 QQ Bot 实网验收仍需要部署方提供真实凭据、已备案 HTTPS 回调和目标 OpenID；本地模拟测试不能替代 QQ 返回的成功响应与 Trace ID。

真实支付还需要部署方提供兼容易支付协议的商户凭据，并在支付服务后台配置公网 HTTPS 异步通知。开发沙箱与人工确认不能作为真实在线支付验收证据。
