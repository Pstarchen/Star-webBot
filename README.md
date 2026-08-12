# StarBot Console

多用户、多机器人、可扩展的 QQ 官方机器人管理与开发平台。

## 已实现

- 邮箱注册/登录和可选 QQ OAuth 登录；密码使用 scrypt，登录会话使用 HttpOnly Cookie。
- 登录/注册限流、会话轮换、来源校验和管理员权限服务端校验。
- 免费版、专业版、团队版会员套餐；套餐定义机器人、SDK 应用和事件保留额度。
- 管理员可分配套餐、覆盖单用户机器人配额、调整角色并停用账号。
- 添加机器人时真实验证 AppID/Client Secret，Secret 使用 AES-256-GCM 加密。
- 机器人默认使用 WebSocket，也可选择 QQ 官方 Webhook 接入。WebSocket 按官方建议分片数建立完整连接组，支持服务端 Intents 策略、Identify 频控、Heartbeat、ACK 超时、Resume、抖动退避和重启自动恢复。
- SQLite 租约保证单机多 Node 实例下同一机器人只有一个 Gateway 所有者，实例异常后可自动接管。
- Gateway 事件持久化到 SQLite，并按会员套餐自动清理过期记录。
- 支持单聊/群聊消息调试、JSON REST 请求台、原始 multipart 代理和 200MB 富媒体分片上传。
- 支持 QQ 官方 Webhook 接入：每个机器人提供不可猜测的回调地址，完成 Ed25519 challenge、签名校验和事件去重。
- SDK 应用通过签名长轮询消费持久事件，支持 60 秒处理租约、ACK、崩溃重投和最多 5 次领取。
- SDK 可通过 HMAC、Nonce、防重放和权限控制调用绑定机器人的 JSON/multipart QQ OpenAPI，无需接触机器人 Secret，也不要求开发者提供公网 Webhook。
- Radix UI + shadcn 风格响应式控制台，支持 240/64px 侧栏、移动抽屉和 reduced-motion。

## 本地启动

```powershell
cd D:\16493\Desktop\star-webBot
npm install
Copy-Item .env.example .env.local
npm run keygen
```

将 `npm run keygen` 输出写入 `.env.local` 的 `CREDENTIAL_ENCRYPTION_KEY`，并设置管理员账号：

```env
DATABASE_PATH=./data/starbot.db
CREDENTIAL_ENCRYPTION_KEY=32字节Base64密钥
BOOTSTRAP_ADMIN_NAME=系统管理员
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=强密码
```

启动：

```powershell
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)。

## QQ 登录

在 QQ 互联创建网站应用，并把回调地址配置为：

```env
QQ_LOGIN_APP_ID=你的AppID
QQ_LOGIN_APP_SECRET=你的AppSecret
QQ_LOGIN_REDIRECT_URI=http://localhost:3000/api/auth/qq/callback
GATEWAY_INSTANCE_ID=starbot-node-1
```

未配置时，登录页会明确显示“QQ 登录未配置”，不会伪装成可用功能。

## SDK 开发

完整事件消费、ACK 和主动调用 QQ OpenAPI 契约见 [docs/plugin-development.md](docs/plugin-development.md)。可运行示例：

```powershell
$env:STARBOT_PLATFORM_URL='http://localhost:3000'
$env:STARBOT_PLUGIN_ID='创建 SDK 应用时显示的应用 ID'
$env:STARBOT_PLUGIN_SECRET='创建 SDK 应用时显示的应用密钥'
node examples/sdk-app/index.mjs
```

## 验证

```powershell
npm test
npm run lint
npm run build
```

## QQ 官方 Webhook

机器人页会显示专属回调路径。生产部署后复制完整 HTTPS URL 到 QQ 开放平台，并选择需要的事件。平台会自动响应 `op=13` challenge，并验证后续 `X-Signature-Ed25519`。

Webhook 的事件订阅在 QQ 开放平台后台完成。WebSocket 仍需在 Identify 中发送 Intents；当前平台由服务端固定申请已授权的群聊与单聊事件，用户无需填写原始位图。

## 部署边界

单机多 Node 进程可共享 SQLite Gateway 租约和 SDK 事件租约。跨主机高可用集群不应共享 SQLite 网络文件，应迁移到 PostgreSQL/Redis 或独立 Gateway Worker。反向代理需允许最大 201MB 请求体。

QQ OAuth 与 QQ Bot 实网验收仍需要部署方提供真实凭据、已备案 HTTPS 回调和目标 OpenID；本地模拟测试不能替代 QQ 返回的成功响应与 Trace ID。
