# QQ Bot API v2 能力矩阵

本矩阵于 2026-08-13 对照 QQ 机器人 API v2 官方目录、Gateway 和 Webhook 契约审计。官方 sitemap 标记 API v2 文档于 2026-07-21 更新，更新日志说明自 2026-08-10 起 OpenAPI 域名统一为 `https://api.bot.qq.com`。平台提供通用传输层，不把每个官方资源接口重复实现为独立页面。

当前官方自动生成目录包含 34 个接口：`GET` 11 个、`POST` 16 个、`PUT` 1 个、`PATCH` 2 个、`DELETE` 4 个。平台 JSON 代理覆盖这些方法；上传到预签名外部地址的 `PUT` 由富媒体上传流程专门处理。

## 已覆盖

| 能力 | 实现 |
| --- | --- |
| Access Token | 服务端缓存，并在过期前 60 秒刷新 |
| 机器人资料 | 添加机器人时调用 `GET /users/@me`，自动保存 QQ 官方 `username`，无需用户填写名称 |
| JSON OpenAPI | 支持 `GET/POST/PUT/PATCH/DELETE`、JSON 请求体和 Trace ID |
| 官方端点目录 | 官方当前 34 个自动生成接口具备稳定端点 ID、路径参数编码、查询参数和 SDK `callEndpoint`；通用 `request` 继续覆盖频道扩展及后续 REST 接口 |
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
| 托管插件 | ZIP 清单校验、项目/版本、机器人安装、动态配置、优先级、启停、KV 与运行日志；支持异步处理器读取 QQ 响应；`events: ["*"]` 可接收平台已收到的全部事件 |
| 插件隔离执行 | QuickJS 16MB 内存、150ms CPU 截止、30 秒墙钟截止、12 个动作/QQ 请求、权限前置校验和连续失败停用 |
| 插件市场 | 搜索分类、私有安装、开发者上架申请、管理员审核和当前市场版本 |
| 兼容远程应用 | 持久队列、HMAC-SHA256 长轮询、60 秒处理租约、ACK、过期重投和受控 OpenAPI |

上述通用代理可转发机器人已获授权的消息、频道、成员、群管理、公告、日程、帖子、音频、互动、富媒体和后续新增的同源 JSON REST 接口。它不绕过 QQ 的接口权限、参数校验或业务限制；实网成功仍以 QQ 响应和 Trace ID 为准。

## Intents 边界

- QQ 开放平台后台决定机器人可订阅的事件权限；Webhook 的事件选择也在该后台完成。
- WebSocket 与 Webhook 不同：Gateway Identify 请求仍必须携带 Intents，不能省略，也不能无条件发送 `0xFFFFFFFF`。
- 请求机器人未获授权的 Intent 位可能导致 Gateway 关闭连接。当前平台固定申请 `GROUP_AND_C2C_EVENT`，以稳定接收群聊和单聊事件。
- QQ 未提供“查询当前机器人已获授权 Intents 位图”的 OpenAPI，因此 WebSocket 不能根据后台选择自动推导全量位图；需要全部后台订阅事件时应使用 Webhook，平台会把收到的任意事件类型继续分发给 `events: ["*"]` 插件。
- 因此“用户无需填写 Intents”不等于“WebSocket 自动收到全部 QQ 事件类型”。后续扩展应使用管理员维护的服务端 Intent 策略，而不是开放原始整数输入。

## 验收状态

| 项目 | 状态 |
| --- | --- |
| 本地协议测试 | Vitest 覆盖插件 ZIP/隔离/KV/审核/SDK 构建、QQ OpenAPI 方法与请求体、自动读取机器人名称、媒体哈希/分片字节、Gateway 租约/Session、事件幂等、Webhook Ed25519、OAuth 和数据库迁移 |
| 本地 HTTP 测试 | 31 条生产 HTTP 工作流覆盖认证、权限、会员、托管插件导入/安装/配置/事件执行/审核/卸载、Webhook challenge 和兼容远程应用签名链路 |
| 真实 Gateway 只读验收 | 两个已配置机器人在开发服务重启后恢复为在线；跨 35 秒检查 ACK 持续更新、SQLite 所有权租约续期 |
| QQ OAuth 实网 | 需要部署方提供 QQ 互联 AppID/AppSecret 和已备案 HTTPS 回调 |
| QQ Bot 只读实网 | 2026-08-13 使用数据库内两个机器人调用 `GET /users/@me` 与 `GET /gateway/bot`，均返回 HTTP 200、官方名称和 Trace ID |
| QQ Bot 写操作实网 | 2026-08-13 测试 AppID 的群发送请求已到达 QQ，返回 `40034105 主动消息失败, 无权限`，未产生消息；群禁言查询返回 `11703 not group admin`。需先开放主动消息权限并把机器人设为测试群管理员，再完成发送后撤回及禁言闭环 |

未提供真实 QQ 凭据时，不能把本地模拟成功表述为 QQ 实网成功。上线后应以 QQ 返回的成功响应和 Trace ID 为最终证据。

## 部署约束

- SQLite 多实例协调要求所有 Node 实例使用同一个支持文件锁的共享数据库文件；不适合多主机网络文件系统。
- 单机多进程可以共享租约与 SDK 事件队列。跨主机生产集群应把数据库迁移到 PostgreSQL，并使用数据库锁或独立 Gateway Worker。
- 反向代理必须允许 WebSocket 出站、最大 201MB 请求体，并为 QQ 官方 Webhook 提供公网 HTTPS 地址。
- 每次 QQ 官方文档更新后，应重新检查路径、请求体、事件类型和授权范围。
