# StarBot 插件平台架构

## 目标流程

```text
开发者插件目录
  -> SDK 构建 ZIP
  -> 平台校验包、清单、入口和可选配置页
  -> 创建项目与不可变版本
  -> 私有安装到机器人
  -> 按安装实例配置、记录、优先级和启停
  -> QQ 事件进入平台
  -> 按优先级在 QuickJS 中运行
  -> 验证结构化动作与权限
  -> 平台调用 QQ OpenAPI / 写 KV
  -> 保存运行记录
  -> 申请审核并发布到市场
```

## 数据边界

| 表 | 职责 |
| --- | --- |
| `plugin_projects` | 所有者、展示信息、市场状态 |
| `plugin_versions` | 不可变清单、入口代码、可选配置页 HTML、包哈希和扫描结果 |
| `plugin_installations` | 用户、机器人、版本、优先级、启停和失败状态 |
| `plugin_config_values` | 安装实例配置 |
| `plugin_kv` | 安装实例受限持久数据 |
| `plugin_runs` | 每次事件运行状态、耗时、动作和日志 |
| `plugin_market_reviews` | 开发者上架申请与管理员结论 |
| `plugin_market_listings` | 当前市场版本、精选和价格元数据 |

旧 `plugins`、`plugin_deliveries`、`plugin_request_nonces` 表保留给远程应用兼容接口，新托管插件不依赖长轮询队列或签名密钥。

## 运行边界

QuickJS 默认不暴露 Node.js、DOM 或网络全局。宿主仅注入 `StarBot.definePlugin` 和事件执行入口，插件通过 SDK 生成结构化动作。主进程在执行任何动作前完成：

1. 清单权限校验。
2. QQ API 相对路径校验。
3. 外部 HTTP 协议、DNS 地址、重定向、头部和载荷大小校验。
4. 动作数量和 JSON 大小校验。
5. KV 数量和容量校验。
6. 回复目标和触发消息上下文补全。

插件代码不直接接触机器人 Client Secret、Access Token、数据库连接或文件路径。

## 配置控制面

插件有两种配置呈现方式，共用同一个 `configSchema` 和服务端校验器：

1. 宿主根据 `text`、`textarea`、`number`、`boolean`、`select`、`api-list`、`reply-list` 渲染标准控件。
2. 插件声明 `configPage.entry` 后，宿主加载插件自己的 HTML 页面，支持业务表格、编辑弹窗、标签页、预览和记录管理。

自定义页面不直接获得宿主 React 组件或数据库访问权。宿主将其放入 `sandbox="allow-scripts"` 的 iframe，并用 CSP 禁止直接网络、表单、父页面 DOM、Cookie 和 Web Storage。页面通过 `postMessage` 请求桥接能力：

```text
config.html
  -> StarBotConfig.getState()
  -> StarBotConfig.saveConfig(config)
  -> StarBotConfig.records.list/set/delete
  -> parent bridge validates source + request id
  -> same-origin authenticated host route
  -> ownership, schema, permission and quota checks
```

配置页只能操作当前安装实例。`saveConfig` 仍经过清单 schema 校验；`records.*` 需要 `storage:kv`，并复用 `plugin_kv` 的 100 key、16 KB 单值、128 KB 总量限制。运行时 `sdk.kv` 与配置页记录读取同一数据，因此可以实现规则命中统计、人工维护词库和业务状态查看，而不增加一套绕过权限模型的存储。

配置页 HTML 随插件版本写入 `plugin_versions.config_page_html`，安装实例只引用不可变版本。新版本不会原地改写旧版本的页面或入口代码。

## 事件顺序

同一机器人的启用插件按 `priority ASC`、安装时间排序。未订阅当前事件的插件跳过且不写运行记录。插件调用 `stopPropagation` 后，后续托管插件与兼容远程应用均不再接收当前事件。

事件接收和插件执行共用 Gateway/Webhook 幂等收据，因此同一个 QQ 事件通过恢复连接或双通道重复到达时不会重复运行插件。

新建机器人默认 Intent 是 `DIRECT_MESSAGE (1 << 12) | GROUP_AND_C2C_EVENT (1 << 25) | PUBLIC_GUILD_MESSAGES (1 << 30)`，数值为 `1107300352`。清单的 `events` 只做运行时过滤，不修改机器人 Intent；扩展到成员、互动、论坛、音频或私域频道全量消息等事件时，必须先在 QQ 侧获得权限并由宿主管理员调整连接配置。

自动回复目标只从消息事件中推断：C2C 使用 `author.user_openid`，群聊使用 `group_openid`，频道消息使用 `channel_id`，频道私信使用 `guild_id`。其他事件应由插件显式调用受控 QQ API。

## 故障处理

- 插件错误写入 `plugin_runs` 和安装实例 `last_error`。
- 单个插件失败不会阻止其他插件处理事件。
- 成功执行会清零连续失败数。
- 连续 5 次失败自动停用安装实例。
- QQ API 和受控 HTTP 错误保留在运行错误中，但不记录机器人密钥、Access Token 或请求头内容。

## 当前边界

- 托管处理器为同步模型，适合消息解析、回复、KV 和有限 OpenAPI 动作。
- 托管插件可通过受控 QQ API 使用公网 URL 完成单聊/群聊 `/files` 上传；本地二进制读取和分片 PUT 尚未开放。
- QQ 当前文档没有频道 `/files` 端点；频道图片可使用 `image` URL，频道视频/音频需要退化为链接或等待官方能力。
- 定时任务、受控外联域名和插件资产读取尚未开放，需在增加权限模型与专用 Worker 调度后实现。
- SQLite 适合单机共享部署；跨主机集群应迁移到 PostgreSQL 并使用独立事件 Worker。
