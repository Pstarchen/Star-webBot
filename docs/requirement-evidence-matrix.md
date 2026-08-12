# 需求与验收证据矩阵

| 需求 | 当前证据 | 状态与边界 |
| --- | --- | --- |
| 多用户邮箱注册登录 | `tests/http-e2e.mjs` 注册、重复注册、错误密码、跨域拒绝、登出失效；`tests/core-services.test.ts` 密码与会话测试 | 本地生产流程通过 |
| QQ 登录 | `tests/qq-login.test.ts` 覆盖授权 state 与回调地址绑定、一次性消费、首次建号、账号复用、异常上游响应和 Cookie 清理；QQ OAuth start/callback 路由 | 本地契约通过；仍需 QQ 互联真实应用和 HTTPS 回调实网验收 |
| 管理员角色与停用 | HTTP E2E 覆盖普通用户越权、跨域拒绝、当前管理员保护、配额下限、用户停用/恢复；服务测试覆盖末位管理员保护 | 本地生产流程通过 |
| 单用户机器人配额 | 管理员配额接口、机器人创建前数据库计数；HTTP E2E 验证套餐和覆盖配额 | 本地生产流程通过 |
| 会员套餐 | 免费/专业/团队套餐、机器人/SDK 应用/事件保留额度；管理员分配接口 | 本地生产流程通过；支付计费不在当前需求中 |
| WebSocket 接入 | `tests/gateway-manager.test.ts` 覆盖 Hello/Identify、固定 `GROUP_AND_C2C_EVENT`、Heartbeat/ACK、READY 会话持久化、Resume、Invalid Session、Identify 窗口限流、陈旧 socket 隔离和 fatal close；多分片、SQLite 所有权租约；2026-08-12 重启开发服务后两个真实机器人均记录 `RESUMED`，跨 35 秒观察仍在线、ACK 持续更新且租约续期 | 本地协议与真实 Gateway 持续运行通过；未发送外部 QQ 消息；跨主机 HA 需 PostgreSQL/独立 Worker |
| QQ 官方 Webhook 接入 | 独立机器人接入模式、不可猜测 URL、AppID、Ed25519 challenge/事件验签、事件去重；生产 E2E 使用真实算法签名 | 本地生产流程通过；公网 HTTPS 回调以 QQ 平台实际投递为最终证据 |
| Intents | UI/API 不接收原始 Intents；Gateway Identify 固定请求 `GROUP_AND_C2C_EVENT`，并受 QQ 后台授权范围约束；Webhook 事件由 QQ 后台选择 | 已完成当前群聊/单聊策略；未声明覆盖全部 QQ 事件类型 |
| 用户自行开发功能 | `sdk/node`、SDK 应用创建/停用/密钥轮换/删除、事件长轮询/租约/ACK/重投、事件路由和消息快捷接口 | 单测与生产 E2E 通过 |
| QQ Bot API v2 功能 | 2026-08-12 审计官方 34 个自动生成接口；用户和 SDK 均有 JSON 与原始 multipart 通用代理；富媒体官方分片流程 | 当前方法集合全部可转发；外部预签名 PUT 由媒体流程处理；业务授权与实网结果仍由 QQ 决定 |
| UI 与响应式 | Radix Dialog/Select/Switch/Dropdown/Tabs/Tooltip，shadcn 风格组件，Lucide 图标；关键表单源码已移除原生 select/checkbox；桌面与 390×844 浏览器检查覆盖工作台、抽屉、机器人、SDK 应用和管理员页面 | 无横向溢出、无应用控制台错误、支持 reduced-motion；Radix 下拉暴露标准 combobox/listbox/option 语义 |
| 数据迁移 | 旧 `workflow/webhook_*` 插件表原位重建为 `sdk/signing_secret_cipher`，保留投递与 Nonce；修复两个历史本地种子账号的编码名称 | 真实库迁移标记存在、旧列已移除、外键违规为 0；迁移测试覆盖数据保留和名称修复 |
| 安全 | AES-256-GCM 凭据、HttpOnly 会话、CSRF 来源校验、限流、HMAC/Nonce、防重放、Webhook Ed25519 | 32 项 Vitest、类型检查、Lint、生产构建和 21 条 HTTP E2E 通过 |

## 最终实网验收

QQ OAuth 需要 QQ 互联 AppID/AppSecret 与已备案 HTTPS 回调。机器人写操作需要目标用户/群 OpenID；应以 QQ 返回的成功响应和 `X-Tps-trace-ID` 为最终证据，不能用本地模拟替代。
