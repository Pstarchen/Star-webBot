# StarBot 托管插件开发

StarBot 插件由开发者在本地编写并构建为 ZIP 包，再导入平台。平台负责版本管理、安装到机器人、配置、启停、事件分发和 QQ API 调用；插件不会获得机器人 Client Secret，也不需要部署 Webhook 或长期运行独立进程。

## 快速开始

仓库提供插件 SDK 和构建工具：

```powershell
npm install ./sdk/plugin
```

插件目录至少包含：

```text
hello-plugin/
  starbot.plugin.json
  index.js
  README.md
```

构建可导入包：

```powershell
npx starbot-plugin ./hello-plugin ./dist/hello-plugin.zip
```

仓库示例可直接构建：

```powershell
node sdk/plugin/build.mjs examples/hosted-plugin dist/hello-starbot.zip
```

在控制台打开“插件中心 -> 导入插件包”，选择生成的 ZIP。新项目和新版本默认仅当前开发者可见，可直接私有安装到自己的机器人；申请上架并通过管理员审核后才会进入插件市场。

## 插件清单

`starbot.plugin.json` 使用 `schemaVersion: 1`：

```json
{
  "schemaVersion": 1,
  "id": "hello-starbot",
  "name": "你好 StarBot",
  "version": "1.0.0",
  "description": "收到指定关键词后自动回复。",
  "author": "Your Name",
  "category": "消息互动",
  "tags": ["自动回复"],
  "entry": "index.js",
  "events": ["C2C_MESSAGE_CREATE", "GROUP_AT_MESSAGE_CREATE"],
  "permissions": ["reply:text", "storage:kv", "log:write"],
  "commands": [
    { "name": "你好", "description": "回复欢迎消息" }
  ],
  "configSchema": [
    {
      "key": "reply",
      "label": "回复内容",
      "type": "textarea",
      "required": true,
      "default": "你好，欢迎使用 StarBot。"
    }
  ]
}
```

支持的配置字段类型为 `text`、`textarea`、`number`、`boolean`、`select`。配置由平台按机器人安装实例保存，同一个插件安装到不同机器人时可以使用不同配置。

`events` 仅过滤平台已经从 QQ WebSocket 或 QQ 官方 Webhook 接收到的事件，不会修改 QQ 开放平台后台订阅。填写 `["*"]` 可接收平台收到的全部事件。WebSocket Identify 使用平台维护的 Intent 策略，用户和插件均不填写原始 Intent 位图。

## 事件处理器

入口脚本必须且只能调用一次 `StarBot.definePlugin`：

```js
StarBot.definePlugin({
  async onEvent(event, sdk) {
    const content = String(event.data && event.data.content || "");
    if (!content.includes(String(sdk.config.keyword))) return;

    const profile = await sdk.qq.getBotProfile();
    const count = sdk.kv.get("count", 0) + 1;
    sdk.kv.set("count", count);
    sdk.reply.text(`${profile.body.username}：${sdk.config.reply}\n第 ${count} 次触发`);
    sdk.log.info("keyword matched", { count });
  },
});
```

`onEvent` 支持同步或异步处理器。插件可以 `await sdk.qq.*` 读取 QQ 的响应体和 Trace ID，但不能使用定时器、Node.js 模块、文件系统或直接网络请求。网络访问只允许通过平台注入的 QQ SDK，并受清单权限、路径校验和超时限制。

事件结构：

```ts
type StarBotEvent<T = Record<string, unknown>> = {
  type: string;
  botId: string;
  data: T;
};
```

`data` 保留 QQ 官方事件载荷。消息事件通常包含 `id`、`content`、作者 OpenID、群 OpenID、附件和时间戳，具体字段以 QQ 官方事件文档为准。

## SDK 能力

### 回复

```js
sdk.reply.text("文本回复");
sdk.reply.markdown({ custom_template_id: "...", params: [] });
sdk.reply.ark({ template_id: 23, kv: [] });
sdk.reply.keyboard({ content: { rows: [] } });
```

平台根据事件场景自动选择单聊或群聊消息接口，并补充触发事件的 `msg_id` / `event_id` 与递增 `msg_seq`。

### 受控 QQ OpenAPI

```js
const sent = await sdk.qq.sendGroup("<group_openid>", {
  content: "主动消息",
  msg_type: 0
});

await sdk.qq.recallGroup("<group_openid>", sent.body.id);

await sdk.qq.muteGroupMember(
  "<group_openid>",
  "<member_openid>",
  "2026-08-14T12:00:00+08:00"
);

await sdk.qq.unmuteGroupMember("<group_openid>", "<member_openid>");

const requests = await sdk.qq.callEndpoint(
  "listGroupJoinRequests",
  { group_openid: "<group_openid>" },
  undefined,
  { limit: 20 }
);
```

`sdk.qq.callEndpoint(endpointId, pathParams, body, query)` 覆盖官方当前自动生成目录的 34 个接口并负责路径参数编码；`sdk.qq.request(method, path, body)` 可调用频道扩展接口及官方后续新增的 JSON REST 接口。两者都返回 `{ body, traceId }`。只有声明 `qq:api` 权限的插件可以调用，平台会在网络请求前检查权限，只接受 QQ Bot API 相对路径，并拒绝外部 URL 和路径穿越。

通用方法覆盖 QQ 官方文档当前及后续新增的 JSON REST 接口，包括机器人、群聊、频道、成员、身份组、消息、公告、日程和互动等能力。远程 Node SDK 另提供 `callMultipart(path, formData)` 处理官方文件上传接口；托管插件不能直接读取宿主文件系统或自行联网。

普通 QQ 群成员禁言使用 `/v2/groups/{group_openid}/restrict_chat_setting`，与 QQ 频道的 `/guilds/{guild_id}/members/{user_id}/mute` 不是同一接口。机器人必须是该群管理员；只能禁言普通成员，不能禁言群主、管理员或机器人。`mute_expire_at` 使用 RFC3339 时间。撤回单聊或群聊消息时，QQ 官方限制消息发送后 2 分钟内可撤回。最终可调用范围仍由 QQ 开放平台授权和机器人所在会话权限决定。

### 插件 KV

```js
const value = sdk.kv.get("counter", 0);
sdk.kv.set("counter", value + 1);
sdk.kv.delete("counter");
```

需要声明 `storage:kv`。每个安装实例最多 100 个键，单值最大 16KB，总量最大 128KB。插件卸载时对应 KV 一并删除。

### 日志与传播

```js
sdk.log.info("handled", event.type);
sdk.stopPropagation();
```

日志需要 `log:write`。`stopPropagation` 会阻止优先级更低的托管插件和兼容远程应用继续接收当前事件。

## 权限

| 权限 | 能力 |
| --- | --- |
| `reply:text` | 文本回复 |
| `reply:markdown` | Markdown 回复 |
| `reply:ark` | ARK 回复 |
| `reply:keyboard` | keyboard 回复 |
| `qq:api` | 调用受控 QQ OpenAPI 并读取响应 |
| `storage:kv` | 使用安装级 KV |
| `log:write` | 写入插件运行日志 |

所有动作在产生副作用前统一验证权限和路径。插件不能读取机器人密钥、平台数据库、宿主文件或环境变量。

## 运行限制

- QuickJS WebAssembly 隔离运行，不在 Next.js 主进程中 `import()` 插件代码。
- 单段插件代码 CPU 截止时间 150ms、包含 QQ 等待在内的墙钟时间 30 秒、内存 16MB、栈 512KB。
- 单次最多 12 个动作或 QQ 请求、30 条日志，输入、输出和单个 QQ 响应 JSON 各最大 64KB。
- ZIP 最大 2MB、最多 40 个文件、单文件最大 1MB、总解压大小最大 4MB。
- 连续 5 次失败后自动停用该安装实例，需要用户检查错误后手动重新启用。

这些限制用于保护共享平台，不代表插件可以处理所有长耗时任务。需要外部服务时，应通过管理员审核的受控能力扩展，而不是尝试在插件脚本中直接联网。

## 版本与市场

1. 首次导入创建插件项目和版本，状态为“仅自己可用”。
2. 相同 `id`、不同 `version` 的包导入为同一项目的新版本。
3. 私有版本可直接安装到开发者自己的机器人。
4. 开发者选择版本申请市场审核。
5. 管理员审核通过后，该版本成为市场当前版本；驳回时记录原因。
6. 市场安装默认停用，用户完成配置后手动启用。

## 兼容远程应用

旧版 `sdk/node`、`/api/plugins` 与 `/api/plugin-runtime/*` 长轮询接口暂时保留，供已有外部进程迁移使用。它们属于“远程应用”兼容能力，不是当前插件商店和托管插件开发模型。新插件应使用 `sdk/plugin` 构建并直接导入平台。
