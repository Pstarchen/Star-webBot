# StarBot 插件平台架构

## 目标流程

```text
开发者插件目录
  -> SDK 构建 ZIP
  -> 平台校验包和清单
  -> 创建项目与不可变版本
  -> 私有安装到机器人
  -> 按安装实例配置和启停
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
| `plugin_versions` | 不可变清单、入口代码、包哈希和扫描结果 |
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
3. 动作数量和 JSON 大小校验。
4. KV 数量和容量校验。
5. 回复目标和触发消息上下文补全。

插件代码不直接接触机器人 Client Secret、Access Token、数据库连接或文件路径。

## 事件顺序

同一机器人的启用插件按 `priority ASC`、安装时间排序。未订阅当前事件的插件跳过且不写运行记录。插件调用 `stopPropagation` 后，后续托管插件与兼容远程应用均不再接收当前事件。

事件接收和插件执行共用 Gateway/Webhook 幂等收据，因此同一个 QQ 事件通过恢复连接或双通道重复到达时不会重复运行插件。

## 故障处理

- 插件错误写入 `plugin_runs` 和安装实例 `last_error`。
- 单个插件失败不会阻止其他插件处理事件。
- 成功执行会清零连续失败数。
- 连续 5 次失败自动停用安装实例。
- QQ API 错误保留在运行错误中，但不记录机器人密钥或 Access Token。

## 当前边界

- 托管处理器为同步模型，适合消息解析、回复、KV 和有限 OpenAPI 动作。
- 富媒体二进制上传尚未开放给托管插件；用户仍可通过开发者中心调用平台富媒体接口。
- 定时任务、受控外联域名和插件资产读取尚未开放，需在增加权限模型与专用 Worker 调度后实现。
- SQLite 适合单机共享部署；跨主机集群应迁移到 PostgreSQL 并使用独立事件 Worker。
