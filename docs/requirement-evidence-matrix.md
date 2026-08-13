# 需求与验收证据矩阵

| 需求 | 当前证据 | 状态与边界 |
| --- | --- | --- |
| 多用户邮箱注册登录 | `tests/http-e2e.mjs` 注册、重复注册、错误密码、跨域拒绝、登出失效；`tests/core-services.test.ts` 密码与会话测试 | 本地生产流程通过 |
| QQ 登录 | `tests/qq-login.test.ts` 覆盖数据库后台配置优先、环境变量回退、授权 state 与回调地址绑定、一次性消费、首次建号、账号复用、异常上游响应和 Cookie 清理；QQ OAuth start/callback 路由 | 本地契约通过；仍需 QQ 互联真实应用和 HTTPS 回调实网验收 |
| 管理员角色与停用 | HTTP E2E 覆盖普通用户越权、跨域拒绝、当前管理员保护、配额下限、用户停用/恢复；服务测试覆盖末位管理员保护 | 本地生产流程通过 |
| 单用户机器人配额 | 管理员配额接口、机器人创建前数据库计数；HTTP E2E 验证套餐和覆盖配额 | 本地生产流程通过 |
| 系统设置与品牌 | 管理员站点设置 API、Logo/favicon 二进制存储与公开读取；HTTP E2E 覆盖权限、名称、介绍、备案信息和 Logo 持久化；登录页、控制台、Metadata 和页脚读取公开设置 | 本地生产流程通过 |
| 会员套餐与支付 | 免费/专业/团队套餐、机器人/插件/事件权益、月/季/年服务端计价；沙箱自动支付、人工订单审核、易支付 MD5 签名与异步通知验签；服务测试覆盖自然月有效期、幂等确认、越权拒绝、到期回退，HTTP E2E 覆盖金额防篡改与自动升级 | 本地流程通过；真实易支付需商户凭据和公网 HTTPS 回调实网验收 |
| WebSocket 接入 | `tests/gateway-manager.test.ts` 覆盖 Hello/Identify、固定 `GROUP_AND_C2C_EVENT`、Heartbeat/ACK、READY 会话持久化、Resume、Invalid Session、Identify 窗口限流、陈旧 socket 隔离和 fatal close；多分片、SQLite 所有权租约；2026-08-12 重启开发服务后两个真实机器人均记录 `RESUMED`，跨 35 秒观察仍在线、ACK 持续更新且租约续期 | 本地协议与真实 Gateway 持续运行通过；未发送外部 QQ 消息；跨主机 HA 需 PostgreSQL/独立 Worker |
| QQ 官方 Webhook 接入 | 独立机器人接入模式、不可猜测 URL、AppID、Ed25519 challenge/事件验签、事件去重；生产 E2E 使用真实算法签名 | 本地生产流程通过；公网 HTTPS 回调以 QQ 平台实际投递为最终证据 |
| Intents | UI/API 不接收原始 Intents；Gateway Identify 固定请求 `GROUP_AND_C2C_EVENT`，并受 QQ 后台授权范围约束；Webhook 事件由 QQ 后台选择 | 已完成当前群聊/单聊策略；未声明覆盖全部 QQ 事件类型 |
| 用户自行开发插件 | `sdk/plugin` 类型与构建器、ZIP 清单校验、项目/版本、私有安装、动态配置、优先级、启停、KV、运行记录；支持 `events: ["*"]` 和通用 QQ OpenAPI 动作；示例包由测试真实构建 | 插件无需部署独立进程或 Webhook；特殊事件仍受 QQ 后台授权和 Gateway Intents 约束 |
| 插件市场与审核 | 数据库市场条目、搜索/分类/详情、开发者上架申请、管理员通过/驳回、审核版本隔离、每项目单一待审版本 | 服务测试与生产 E2E 通过 |
| 插件隔离与权限 | QuickJS 16MB/150ms、无 Node/网络全局、结构化动作、权限和 QQ 路径前置校验、KV 限额、连续 5 次失败停用 | 包炸弹、路径穿越、CPU 超时、越权动作和失败停用测试通过 |
| 兼容远程应用 | `sdk/node`、签名长轮询、租约/ACK/重投、密钥轮换和受控 OpenAPI | 保留给已有客户端迁移；不是新插件主体模型 |
| QQ Bot API v2 功能 | 2026-08-13 对照官方 API v2；官方当前 34 个自动生成接口有端点目录与 `callEndpoint`，用户和 SDK 均有 `GET/POST/PUT/PATCH/DELETE` JSON 通用代理与原始 multipart 通道；富媒体使用官方分片流程；添加机器人通过 `/users/@me` 自动读取名称 | 托管插件可异步读取 `{ body, traceId }` 并继续业务逻辑；频道扩展及后续同源 JSON REST 接口可直接转发；外部预签名 PUT 由媒体流程处理；业务授权与实网结果仍由 QQ 决定 |
| UI 与响应式 | Radix Dialog/Select/Switch/Tabs/Tooltip，shadcn 风格组件，Lucide 图标；包含会员账单、站点/QQ/支付/套餐/订单设置与插件中心 | 2026-08-13 浏览器验收桌面与 390×844：会员页和系统设置五个分类完整，移动抽屉正常，无页面级横向溢出或控制台错误 |
| 数据迁移 | 旧 `workflow/webhook_*` 表保留迁移兼容；新增项目、版本、安装、配置、KV、运行、审核和市场表，不改写现有机器人与远程应用数据 | 迁移测试覆盖旧数据/外键保留；真实库启动迁移通过 |
| 安全 | AES-256-GCM 凭据、敏感设置不回传明文、服务端订单计价、支付幂等、HttpOnly 会话、CSRF 来源校验、限流、HMAC/Nonce、防重放、Webhook Ed25519、QuickJS 隔离与插件权限 | 63 项 Vitest、类型检查、干净 Lint、生产构建和 31 条 HTTP E2E 通过 |

## 最终实网验收

QQ OAuth 需要 QQ 互联 AppID/AppSecret 与已备案 HTTPS 回调。机器人写操作需要目标用户/群 OpenID；应以 QQ 返回的成功响应和 `X-Tps-trace-ID` 为最终证据，不能用本地模拟替代。2026-08-13 对测试 AppID 的实网发送请求已到达 QQ，但 QQ 返回 `40034105 主动消息失败, 无权限`；群禁言查询返回 `11703 not group admin`。因此该账号需先获得主动消息权限，并把机器人设为测试群管理员，才能完成发送后撤回及禁言实网闭环。

真实会员支付需要易支付兼容商户凭据和公网 HTTPS 异步通知地址；本地沙箱自动支付仅用于功能联调。
