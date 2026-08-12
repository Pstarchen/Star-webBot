# QQ Bot API v2 能力矩阵

本矩阵于 2026-08-12 对照 QQ 机器人 API v2 官方目录、Gateway 和 Webhook 契约审计。官方 sitemap 标记 API v2 文档于 2026-07-21 更新，更新日志说明自 2026-08-10 起 OpenAPI 域名统一为 `https://api.bot.qq.com`。平台提供通用传输层，不把每个官方资源接口重复实现为独立页面。

当前官方自动生成目录包含 34 个接口：`GET` 11 个、`POST` 16 个、`PUT` 1 个、`PATCH` 2 个、`DELETE` 4 个。平台 JSON 代理覆盖这些方法；上传到预签名外部地址的 `PUT` 由富媒体上传流程专门处理。

## 已覆盖

| 能力 | 实现 |
| --- | --- |
| Access Token | 服务端缓存，并在过期前 60 秒刷新 |
| JSON OpenAPI | 支持 `GET/POST/PUT/PATCH/DELETE`、JSON 请求体和 Trace ID |
| 原始 multipart OpenAPI | 用户路由 `/api/bots/{botId}/multipart?path=...` 流式透传，最大 201MB |
| 富媒体文件上传 | 单聊/群聊 `upload_prepare`、预签名 URL 分片 PUT、`upload_part_finish`、`/files` 合并 |
| 富媒体限制 | 图片/视频/语音扩展名校验、200MB 硬限制、SHA1/MD5、失败重试、临时文件清理 |
| Gateway 生命周期 | Hello、Identify、Heartbeat、ACK、Resume、Reconnect、Invalid Session |
| Gateway 事件订阅 | 用户无需填写位图；Identify 仍按官方协议发送服务端策略 `GROUP_AND_C2C_EVENT (1 << 25)`，仅申请已获授权的群聊与单聊事件 |
| Gateway 分片 | 使用 `/gateway/bot` 的 `shards` 和 `max_concurrency` 建立完整分片组 |
| Session Start Limit | 校验 `remaining`，Identify 使用每 5 秒共享窗口调度 |
| 多实例 Gateway | SQLite 30 秒租约确保同一机器人只有一个活动进程，租约丢失自动停机和接管 |
| Gateway 恢复 | 每分片持久化 Session/Sequence，重启后 Resume，ACK 超时和抖动退避 |
| 事件幂等 | Gateway Resume 与 QQ Webhook 双通道使用事件收据去重 |
| QQ 官方 Webhook | 事件类型在 QQ 开放平台后台订阅；平台提供不可猜测回调 URL、AppID 校验、Ed25519 challenge 与事件签名校验 |
| SDK 事件消费 | 持久队列、HMAC-SHA256 长轮询、60 秒处理租约、ACK、过期重投和最多 5 次领取 |
| SDK 主动 OpenAPI | HMAC、Nonce、防重放、权限和限流保护的 JSON 与 multipart 代理 |

上述通用代理可转发机器人已获授权的消息、频道、成员、群管理、公告、日程、帖子、音频、互动、富媒体和后续新增的同源 JSON REST 接口。它不绕过 QQ 的接口权限、参数校验或业务限制；实网成功仍以 QQ 响应和 Trace ID 为准。

## Intents 边界

- QQ 开放平台后台决定机器人可订阅的事件权限；Webhook 的事件选择也在该后台完成。
- WebSocket 与 Webhook 不同：Gateway Identify 请求仍必须携带 Intents，不能省略，也不能无条件发送 `0xFFFFFFFF`。
- 请求机器人未获授权的 Intent 位可能导致 Gateway 关闭连接。当前平台固定申请 `GROUP_AND_C2C_EVENT`，以稳定接收群聊和单聊事件。
- 因此“用户无需填写 Intents”不等于“WebSocket 自动收到全部 QQ 事件类型”。后续扩展应使用管理员维护的服务端 Intent 策略，而不是开放原始整数输入。

## 验收状态

| 项目 | 状态 |
| --- | --- |
| 本地协议测试 | 32 项 Vitest 覆盖媒体哈希/分片字节、Gateway 租约/Session、事件幂等、Webhook Ed25519、OAuth 和数据库迁移 |
| 本地 HTTP 测试 | 21 条生产 HTTP 工作流覆盖认证、权限、会员、停用失效、跨域、Webhook challenge、SDK 创建/签名拉取/ACK 和未签名请求拒绝 |
| 真实 Gateway 只读验收 | 两个已配置机器人在开发服务重启后恢复为在线；跨 35 秒检查 ACK 持续更新、SQLite 所有权租约续期 |
| QQ OAuth 实网 | 需要部署方提供 QQ 互联 AppID/AppSecret 和已备案 HTTPS 回调 |
| QQ Bot 实网 | 需要真实机器人 AppID/Client Secret、目标 OpenID 与开放平台授权 |

未提供真实 QQ 凭据时，不能把本地模拟成功表述为 QQ 实网成功。上线后应以 QQ 返回的成功响应和 Trace ID 为最终证据。

## 部署约束

- SQLite 多实例协调要求所有 Node 实例使用同一个支持文件锁的共享数据库文件；不适合多主机网络文件系统。
- 单机多进程可以共享租约与 SDK 事件队列。跨主机生产集群应把数据库迁移到 PostgreSQL，并使用数据库锁或独立 Gateway Worker。
- 反向代理必须允许 WebSocket 出站、最大 201MB 请求体，并为 QQ 官方 Webhook 提供公网 HTTPS 地址。
- 每次 QQ 官方文档更新后，应重新检查路径、请求体、事件类型和授权范围。
