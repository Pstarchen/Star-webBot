# StarBot 托管插件开发手册

本文描述仓库当前实现的 Manifest v1、QuickJS 运行时、插件 SDK、自定义配置页、安装级记录、QQ API 调用、事件范围、限制和排错方法。文档中的接口签名以 `sdk/plugin/index.d.ts` 和宿主源码为准。

## 1. 开发模型

StarBot 插件是由宿主执行的 ZIP 包，不是需要单独部署的 Node.js 服务：

```text
QQ Gateway / Webhook
  -> StarBot 验签、去重和记录事件
  -> 按 events 与 priority 选择安装实例
  -> QuickJS 执行 index.js
  -> 校验动作、权限、目标和限额
  -> StarBot 调用 QQ OpenAPI / 外部 HTTP / KV
  -> 保存 plugin_runs
```

宿主负责 QQ AppID、Client Secret、Access Token 获取与刷新。插件不能读取这些凭据，也不能读取宿主文件、数据库或环境变量。不要把任何密钥写入源码、清单、README、日志或普通插件配置。

## 2. 目录、构建和导入

最小插件目录：

```text
my-plugin/
  starbot.plugin.json     # 必需，必须位于 ZIP 根目录
  index.js                # 必需，路径由 manifest.entry 指定
  README.md               # 可选
  config.html             # 声明 configPage 时必需
```

准备 Node.js 20 或更高版本。在宿主仓库根目录执行：

```powershell
npm install ./sdk/plugin
npx starbot-plugin ./my-plugin ./dist/my-plugin.zip
```

也可以直接调用构建脚本：

```powershell
node sdk/plugin/build.mjs examples/hosted-plugin dist/hello-starbot.zip
```

导入时宿主会验证 ZIP、路径、清单、入口代码和可选配置页。不要把整个外层目录直接压进 ZIP；`starbot.plugin.json` 必须位于 ZIP 根目录，否则会返回 `PLUGIN_MANIFEST_MISSING`。

包限制：

| 项目 | 限制 |
| --- | ---: |
| ZIP 大小 | 2 MB |
| 文件数 | 40 |
| 单文件 | 1 MB |
| 入口脚本 / 配置页 | 256 KB |
| 解压后总量 | 4 MB |
| 清单 | 64 KB |

## 3. `starbot.plugin.json`

完整示例：

```json
{
  "schemaVersion": 1,
  "id": "weather-reply",
  "name": "天气回复",
  "version": "1.2.0",
  "description": "根据消息中的城市调用天气接口并回复。",
  "author": "Your Name",
  "category": "消息互动",
  "tags": ["天气", "自动回复"],
  "entry": "index.js",
  "events": [
    "C2C_MESSAGE_CREATE",
    "GROUP_AT_MESSAGE_CREATE",
    "GROUP_MESSAGE_CREATE",
    "AT_MESSAGE_CREATE",
    "DIRECT_MESSAGE_CREATE"
  ],
  "permissions": [
    "reply:text",
    "qq:api",
    "http:request",
    "storage:kv",
    "log:write"
  ],
  "commands": [
    { "name": "天气+城市", "description": "例如：天气+北京" }
  ],
  "configPage": {
    "entry": "config.html",
    "height": 880
  },
  "configSchema": [
    {
      "key": "apiDefinitions",
      "label": "自定义 API",
      "type": "api-list",
      "required": true,
      "default": []
    },
    {
      "key": "replyRules",
      "label": "回复规则",
      "type": "reply-list",
      "required": true,
      "default": []
    },
    {
      "key": "threshold",
      "label": "模糊阈值",
      "type": "number",
      "required": true,
      "default": 0.6,
      "min": 0.1,
      "max": 1
    }
  ]
}
```

### 3.1 清单字段

| 字段 | 必需 | 规则 |
| --- | --- | --- |
| `schemaVersion` | 是 | 固定为 `1` |
| `id` | 是 | 3-64 位，小写字母、数字、连字符；首字符为字母或数字 |
| `name` | 是 | 2-60 字符 |
| `version` | 是 | 语义化版本，如 `1.2.0` 或 `1.2.0-beta.1` |
| `description` | 是 | 10-500 字符 |
| `author` | 是 | 2-80 字符 |
| `category` | 是 | 2-30 字符 |
| `tags` | 否 | 最多 8 项，每项最多 20 字符，不可重复 |
| `entry` | 是 | ZIP 内安全的 `.js` 相对路径，最长 128 字符 |
| `events` | 是 | 1-30 个大写事件名；`["*"]` 表示宿主已收到的全部事件 |
| `permissions` | 否 | 最多 12 项，不可重复，只能使用已支持的权限名 |
| `commands` | 否 | 最多 30 项，仅用于展示使用说明 |
| `configSchema` | 否 | 最多 40 个安装级配置字段 |
| `configPage` | 否 | 插件自己的沙箱配置页 |

`events` 只过滤宿主已经收到的事件，不会替机器人开通 QQ 权限，也不会更改开放平台后台的事件订阅。

### 3.2 权限

| 权限 | 允许的能力 |
| --- | --- |
| `reply:text` | `sdk.reply.text` |
| `reply:markdown` | `sdk.reply.markdown` |
| `reply:ark` | `sdk.reply.ark` |
| `reply:keyboard` | `sdk.reply.keyboard` |
| `qq:api` | 所有 `sdk.qq.*` 调用 |
| `http:request` | `sdk.http.request` |
| `storage:kv` | `sdk.kv.*` 和配置页 `records.*` |
| `log:write` | `sdk.log.*` |

权限在产生副作用前检查。缺失时使用 `PLUGIN_PERMISSION_DENIED:<permission>` 作为错误码。

## 4. 配置模式

配置按安装实例隔离。同一插件安装到两个机器人时，两份配置互不影响。宿主会拒绝清单中不存在的 key。

### 4.1 基础字段

| `type` | 值 | 可用属性 |
| --- | --- | --- |
| `text` | 字符串，最多 4,000 字符 | `placeholder`、`required` |
| `textarea` | 字符串，最多 4,000 字符 | `placeholder`、`required` |
| `number` | 有限数字 | `min`、`max`、`required` |
| `boolean` | 布尔值 | `required` |
| `select` | 字符串、数字或布尔值 | `options`，1-50 项 |

`key` 必须匹配 `^[a-z][a-zA-Z0-9_]{0,39}$`。`label` 最多 60 字符，`description` 最多 200 字符。

### 4.2 `api-list`

最多 50 个 API，总 JSON 大小不超过 128 KB：

```ts
type ApiDefinition = {
  id: string;                       // ^[A-Za-z][A-Za-z0-9_-]{0,63}$
  name: string;                     // 1-80 字符
  method: "GET" | "POST";
  url: string;                      // 1-2,000 字符
  headers: Record<string, string>;  // 最多 20 项
  body?: JsonValue;                 // 单个 body 最大 16 KB
};
```

### 4.3 `reply-list`

最多 100 条规则，总 JSON 大小不超过 128 KB：

```ts
type ReplyRule = {
  id: string;
  name: string;
  prefix: string;                   // 1-200 字符
  match: "exact" | "fuzzy";
  threshold?: number;               // 0.1-1
  apis: string[];                   // 最多 3 个 API id
  reply: {
    text?: string;                  // 最多 4,000 字符
    media: Array<{
      type: "image" | "video" | "audio";
      url: string;                  // 最多 2,000 字符
      caption?: string;             // 最多 500 字符
    }>;                             // 最多 3 项
  };
};
```

每条回复必须至少包含非空文本或一个媒体项。结构化字段既可由宿主的标准编辑器呈现，也可由 `configPage` 实现更适合业务的表格、标签页和编辑弹窗。

## 5. 自定义配置页

### 5.1 声明

```json
{
  "configPage": {
    "entry": "config.html",
    "height": 880
  }
}
```

`entry` 必须是 ZIP 内安全的 `.html` 相对路径；`height` 为 480-1,200 像素。配置页建议提供 HTML 片段，不要依赖外部 JS/CSS 包。

宿主以 iframe 加载页面：

```html
<iframe sandbox="allow-scripts"></iframe>
```

安全边界：

- CSP 默认拒绝所有资源。
- 允许内联脚本、内联样式、HTTPS/data 图片、HTTPS 媒体和 data 字体。
- `connect-src 'none'`，配置页不能直接 `fetch` 外部接口。
- 无 `allow-same-origin`，不能读取宿主 Cookie、LocalStorage 或父页面 DOM。
- 无表单提交、对象嵌入或基地址覆盖。
- 需要保存数据时只能使用宿主注入的 `window.StarBotConfig`。

### 5.2 `StarBotConfig` 桥接

桥接准备完成时会触发 `starbot:config-ready`。脚本通常可以直接在页面末尾初始化：

```js
async function start() {
  const state = await StarBotConfig.getState();
  console.log(state.config, state.capabilities.records);
}

if (window.StarBotConfig) start();
else addEventListener("starbot:config-ready", start, { once: true });
```

#### `getState()`

```ts
const state = await StarBotConfig.getState();
// {
//   installation: { id, name, version, botId, botName },
//   config: Record<string, JsonValue>,
//   configSchema: ConfigField[],
//   capabilities: { records: boolean }
// }
```

#### `saveConfig(config)`

保存完整配置对象。宿主会按 `configSchema` 再次验证类型、必填项、范围、选项和结构化列表，不接受额外 key。

```js
await StarBotConfig.saveConfig({
  apiDefinitions,
  replyRules,
  threshold: 0.65
});
```

页面传给桥接的 JSON 序列化结果不能超过 256 KB；单个结构化配置字段仍受 128 KB 限制。

#### `records.list()`

```js
const { records } = await StarBotConfig.records.list();
// records: Array<{ key: string; value: JsonValue; updatedAt: string }>
```

#### `records.set(key, value)` / `records.delete(key)`

```js
await StarBotConfig.records.set("stats.daily", { date: "2026-08-17", count: 12 });
await StarBotConfig.records.delete("stats.daily");
```

记录 key 必须匹配 `^[A-Za-z0-9_.:-]{1,80}$`，值必须是 JSON 值。必须声明 `storage:kv`。每个安装实例最多 100 个 key，单值最大 16 KB，总量最大 128 KB。配置页记录与运行时 `sdk.kv` 是同一存储空间，更新同名 key 会互相覆盖。

### 5.3 宿主内部 HTTP 路由

配置页应调用桥接，不应直接调用这些路由；下面的路由用于宿主前端或二次开发。它们都要求当前登录会话和安装实例所有权，PUT/PATCH/DELETE 还要求可信同源请求。

| 方法与路径 | 请求 / 响应 |
| --- | --- |
| `GET /api/plugin-installations/:id/config-page` | 返回注入桥接后的沙箱 HTML |
| `PATCH /api/plugin-installations/:id` | `{ enabled?, priority?, versionId?, config? } -> { ok: true }` |
| `GET /api/plugin-installations/:id/records` | `{ records: Array<{ key, value, updatedAt }> }` |
| `PUT /api/plugin-installations/:id/records` | `{ key, value } -> { ok: true }` |
| `DELETE /api/plugin-installations/:id/records` | `{ key } -> { ok: true }` |

## 6. 入口脚本与事件对象

入口必须且只能调用一次 `StarBot.definePlugin`：

```js
StarBot.definePlugin({
  async onEvent(event, sdk) {
    const content = String(event.data && event.data.content || "");
    if (!content.startsWith("天气+")) return;

    const city = content.slice("天气+".length).trim();
    const response = await sdk.http.request(
      "https://api.example.com/weather?city=" + encodeURIComponent(city)
    );
    if (!response.ok) throw new Error("WEATHER_HTTP_" + response.status);

    sdk.reply.text(city + "：" + response.body.temperature + "℃");
    sdk.log.info("weather replied", { city });
    sdk.stopPropagation();
  }
});
```

事件封装：

```ts
type StarBotEvent<T = Record<string, unknown>> = {
  type: string;  // QQ Payload.t
  botId: string;
  data: T;       // QQ Payload.d，保持官方字段
};
```

处理器可同步或异步。QuickJS 不提供 Node.js 模块、`require`、文件系统、环境变量、定时器、原生 `fetch` 或套接字。

## 7. 可以处理的事件

宿主会把收到的所有 QQ Dispatch（`op=0` 且存在 `t`）交给插件分发器；清单 `events` 再做第二层过滤。是否真正收到事件取决于机器人类型、QQ 开放平台授权、Webhook 监听项和 Gateway Intent。

当前新建机器人默认 Gateway Intent 为 `1107300352`，即：

```text
(1 << 12) DIRECT_MESSAGE
| (1 << 25) GROUP_AND_C2C_EVENT
| (1 << 30) PUBLIC_GUILD_MESSAGES
```

### 7.1 消息事件和回复目标

| 事件 | 场景 | 主要字段 | `sdk.reply.*` 目标 | 默认 Intent |
| --- | --- | --- | --- | --- |
| `C2C_MESSAGE_CREATE` | QQ 单聊 | `id`, `content`, `author.user_openid` | `/v2/users/{user_openid}/messages` | 是 |
| `GROUP_AT_MESSAGE_CREATE` | 群 @ 机器人 | `id`, `content`, `group_openid`, `author.member_openid` | `/v2/groups/{group_openid}/messages` | 是 |
| `GROUP_MESSAGE_CREATE` | 群全量消息 | 字段同群 @ 消息 | `/v2/groups/{group_openid}/messages` | 是，但需开启“接收所有消息” |
| `AT_MESSAGE_CREATE` | 公域频道 @ 机器人 | `id`, `content`, `channel_id`, `guild_id`, `author` | `/channels/{channel_id}/messages` | 是 |
| `MESSAGE_CREATE` | 私域频道全量消息 | 字段同频道 @ 消息 | `/channels/{channel_id}/messages` | 否，仅私域 `1 << 9` |
| `DIRECT_MESSAGE_CREATE` | 频道私信 | `id`, `content`, `guild_id`, `channel_id`, `author` | `/dms/{guild_id}/messages` | 是 |

自动回复会带上事件中的 `msg_id` 或 `event_id`，并为多条回复递增 `msg_seq`。非消息事件通常没有可推断的回复目标，调用 `sdk.reply.*` 会得到 `PLUGIN_REPLY_TARGET_UNAVAILABLE`；此时应从事件数据取得目标并显式调用 `sdk.qq.send*`。

### 7.2 官方 Intent 事件目录

| Intent | 事件 |
| --- | --- |
| `GUILDS (1 << 0)` | `GUILD_CREATE`, `GUILD_UPDATE`, `GUILD_DELETE`, `CHANNEL_CREATE`, `CHANNEL_UPDATE`, `CHANNEL_DELETE` |
| `GUILD_MEMBERS (1 << 1)` | `GUILD_MEMBER_ADD`, `GUILD_MEMBER_UPDATE`, `GUILD_MEMBER_REMOVE` |
| `GUILD_MESSAGES (1 << 9)` | `MESSAGE_CREATE`, `MESSAGE_DELETE`，仅私域机器人 |
| `GUILD_MESSAGE_REACTIONS (1 << 10)` | `MESSAGE_REACTION_ADD`, `MESSAGE_REACTION_REMOVE` |
| `DIRECT_MESSAGE (1 << 12)` | `DIRECT_MESSAGE_CREATE`, `DIRECT_MESSAGE_DELETE` |
| `GROUP_AND_C2C_EVENT (1 << 25)` | `C2C_MESSAGE_CREATE`, `FRIEND_ADD`, `FRIEND_DEL`, `C2C_MSG_REJECT`, `C2C_MSG_RECEIVE`, `GROUP_AT_MESSAGE_CREATE`, `GROUP_MESSAGE_CREATE`, `GROUP_ADD_ROBOT`, `GROUP_DEL_ROBOT`, `GROUP_MSG_REJECT`, `GROUP_MSG_RECEIVE` |
| `INTERACTION (1 << 26)` | `INTERACTION_CREATE` |
| `MESSAGE_AUDIT (1 << 27)` | `MESSAGE_AUDIT_PASS`, `MESSAGE_AUDIT_REJECT` |
| `FORUMS_EVENT (1 << 28)` | `FORUM_THREAD_CREATE`, `FORUM_THREAD_UPDATE`, `FORUM_THREAD_DELETE`, `FORUM_POST_CREATE`, `FORUM_POST_DELETE`, `FORUM_REPLY_CREATE`, `FORUM_REPLY_DELETE`, `FORUM_PUBLISH_AUDIT_RESULT`，仅私域机器人 |
| `AUDIO_ACTION (1 << 29)` | `AUDIO_START`, `AUDIO_FINISH`, `AUDIO_ON_MIC`, `AUDIO_OFF_MIC` |
| `PUBLIC_GUILD_MESSAGES (1 << 30)` | `AT_MESSAGE_CREATE`, `PUBLIC_MESSAGE_DELETE` |

插件不能自行修改 Intent。扩展默认 Intent 前，宿主管理员需要确认 QQ 机器人具备对应特殊事件权限；无权订阅的 Intent 会导致 Gateway 鉴权失败或不下发事件。

## SDK 能力

### 8.1 `sdk.config`

当前安装实例经过宿主校验的只读配置：

```js
const threshold = Number(sdk.config.threshold || 0.6);
const rules = Array.isArray(sdk.config.replyRules) ? sdk.config.replyRules : [];
```

### 8.2 `sdk.reply`

```js
sdk.reply.text("文本");
sdk.reply.markdown({ custom_template_id: "...", params: [] });
sdk.reply.ark({ template_id: 23, kv: [] });
sdk.reply.keyboard({ content: { rows: [] } });
```

对应权限为 `reply:text`、`reply:markdown`、`reply:ark`、`reply:keyboard`。文本最长 2,000 字符。Markdown、Ark、Keyboard 的载荷必须符合 QQ 对应消息接口结构。

### 8.3 `sdk.qq`

所有方法需要 `qq:api`，返回：

```ts
type QQResult<T> = { body: T; traceId: string | null };
```

#### 通用请求

```js
const result = await sdk.qq.request(
  "GET",
  "/guilds/" + encodeURIComponent(guildId)
);
```

只接受 `GET | POST | PUT | PATCH | DELETE` 和 QQ API 相对路径。拒绝外部 URL、`//`、反斜杠、`..`、控制字符和跨域路径。宿主自动添加 QQ 鉴权头。

#### 端点目录

`callEndpoint` 负责路径参数编码和 query 拼接：

```js
const result = await sdk.qq.callEndpoint(
  "listGroupJoinRequests",
  { group_openid: event.data.group_openid },
  undefined,
  { limit: 20 }
);
```

当前内置 ID：

| 分类 | endpointId |
| --- | --- |
| 频道 | `deleteChannel`, `getChannel`, `getGuild`, `updateChannel`, `listGuildChannels`, `createGuildChannel`, `listBotGuilds` |
| 网关/机器人 | `getGateway`, `getBotProfile`, `generateUrlLink` |
| 互动/菜单/面板 | `acknowledgeInteraction`, `getGlobalMenu`, `updateGlobalMenu`, `createCommandPanel`, `listCommandPanels`, `deleteCommandPanel`, `getCommandPanel`, `updateCommandPanelTarget`, `updateCommandPanel` |
| 群 | `approveGroupJoinRequest`, `getBotGroupState`, `listGroupJoinRequests`, `getGroupInfo`, `sendGroupMessage`, `recallGroupMessage`, `getGroupMuteSettings`, `setGroupMemberMute` |
| 群入群策略 | `createGroupJoinApprovalStrategy`, `listGroupJoinApprovalStrategies`, `updateGroupJoinApprovalStrategy`, `deleteGroupJoinApprovalStrategy`, `executeGroupJoinApprovalStrategy`, `updateGroupJoinApprovalWhitelist` |
| 群媒体 | `prepareGroupMediaUpload`, `finishGroupMediaPart`, `uploadGroupMedia` |
| 单聊/媒体 | `prepareC2CMediaUpload`, `finishC2CMediaPart`, `uploadC2CMedia`, `sendC2CMessage`, `recallC2CMessage`, `sendC2CStreamMessage` |

QQ 新增但目录尚未收录的 JSON REST 接口可以用 `sdk.qq.request` 调用。

#### 便捷方法

```js
await sdk.qq.sendC2C(userOpenid, payload);
await sdk.qq.sendGroup(groupOpenid, payload);
await sdk.qq.sendChannel(channelId, payload);
await sdk.qq.sendDms(guildId, payload);

await sdk.qq.getBotProfile();
await sdk.qq.recallC2C(userOpenid, messageId);
await sdk.qq.recallGroup(groupOpenid, messageId);
await sdk.qq.getGroupMuteSettings(groupOpenid);
await sdk.qq.muteGroupMember(groupOpenid, memberOpenid, "2026-08-17T12:00:00+08:00");
await sdk.qq.unmuteGroupMember(groupOpenid, memberOpenid);
```

频道和频道私信发送路径分别是 `/channels/{channel_id}/messages` 与 `/dms/{guild_id}/messages`。`sendDms` 的参数是私信会话事件里的 `guild_id`，不是 `channel_id`。

### 8.4 富媒体

QQ 单聊和群聊的 URL 上传流程：

```js
const uploaded = await sdk.qq.request(
  "POST",
  "/v2/groups/" + encodeURIComponent(groupOpenid) + "/files",
  { file_type: 1, url: "https://cdn.example.com/image.png", srv_send_msg: false }
);

await sdk.qq.sendGroup(groupOpenid, {
  msg_type: 7,
  media: { file_info: uploaded.body.file_info },
  msg_id: event.data.id,
  msg_seq: 1
});
```

`file_type`：`1` 图片、`2` 视频、`3` 语音、`4` 文件。单聊使用 `/v2/users/{user_openid}/files`，群聊使用 `/v2/groups/{group_openid}/files`；两种场景的 `file_info` 不能混用。

频道消息可以使用官方频道发送接口的 `image` 公网 URL 字段。QQ 当前富媒体上传文档只列出单聊和群聊 `/files`，没有频道 `/files` 端点，因此托管插件不能假设频道视频/音频可按 `msg_type: 7` 上传；可退化为发送公网链接或等待官方开放端点。

### 8.5 `sdk.http.request`

需要 `http:request`：

```js
const response = await sdk.http.request("https://api.example.com/search", {
  method: "POST",
  headers: { "x-client": "starbot-plugin" },
  body: { keyword: "北京" }
});

if (!response.ok) {
  sdk.log.warn("external api failed", response.status);
}
```

返回：

```ts
{
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown; // JSON Content-Type 自动解析，否则为文本
}
```

限制和 SSRF 防护：

- 仅公网 `http/https`，URL 最长 2,000 字符。
- 拒绝 URL 用户名/密码、localhost、`.local`、`.internal`、`.lan`、内网、回环、链路本地、保留和组播地址。
- DNS 解析后校验目标地址，并把请求固定到已校验地址。
- 方法为 `GET | POST | PUT | PATCH | DELETE`；GET 不允许 body。
- 最多 20 个请求头；拒绝 Host、Content-Length、Connection、Transfer-Encoding、Upgrade、Proxy-Authorization 和 `sec-*`。
- 请求体最大 32 KB，响应体最大 64 KB。
- 最多 3 次重定向；每个新目标都重新做 DNS/地址校验。
- 跨源重定向删除 `authorization` 和 `cookie`。

### 8.6 `sdk.kv`

需要 `storage:kv`：

```js
const count = sdk.kv.get("counter", 0);
sdk.kv.set("counter", count + 1);
sdk.kv.delete("counter");
```

key 规则和容量与配置页记录相同：100 个 key、单值 16 KB、总量 128 KB。值必须能被 `JSON.stringify` 正常序列化。

### 8.7 `sdk.log` 与传播

```js
sdk.log.debug("detail", { id: event.data.id });
sdk.log.info("handled", event.type);
sdk.log.warn("degraded");
sdk.log.error("failed", { code: "WEATHER_API_FAILED" });
sdk.stopPropagation();
```

日志需要 `log:write`，单次最多 30 条，每条最多 1,000 字符。不要记录凭据、完整鉴权头或敏感用户内容。

`stopPropagation()` 使优先级更低的托管插件和兼容远程应用不再接收当前事件。插件按 `priority ASC` 和安装时间排序。

## 9. 运行限制和故障行为

| 项目 | 限制 |
| --- | ---: |
| 单段 JavaScript CPU 时间 | 150 ms |
| 包含网络等待的墙钟时间 | 30 秒 |
| QuickJS 内存 | 16 MB |
| 栈 | 512 KB |
| 单次操作数 | 12 个回复、KV 或网络操作 |
| 单次日志 | 30 条 |
| 输入、输出、单个网络响应 JSON | 64 KB |
| 连续失败自动停用 | 5 次 |

QQ 或 HTTP Promise 必须 `await`，或显式使用 `.then/.catch/.finally`。未观察到的异步失败会使本次插件运行失败。单个插件失败不会阻止后续插件，但连续 5 次失败会自动停用该安装实例。

每次运行写入 `plugin_runs`：事件类型、事件 key、成功/跳过/失败、耗时、动作数、日志和错误。QQ 调用失败时记录 HTTP 状态与 `traceId`；不要根据官方可能变化的错误文案做业务判断。

## 10. 常见错误码

| 错误 | 含义 |
| --- | --- |
| `PLUGIN_MANIFEST_MISSING` | ZIP 根目录没有 `starbot.plugin.json` |
| `PLUGIN_MANIFEST_JSON_INVALID` | 清单不是合法 JSON |
| `PLUGIN_MANIFEST_INVALID:*` | 清单字段不符合 schema |
| `PLUGIN_ENTRY_MISSING` | 清单 `entry` 指向的 JS 不在包内 |
| `PLUGIN_CONFIG_PAGE_MISSING` | `configPage.entry` 指向的 HTML 不在包内 |
| `PLUGIN_CONFIG_UNKNOWN_KEY` | 保存了 schema 未声明的配置 key |
| `PLUGIN_CONFIG_REQUIRED:<key>` | 必填配置缺失 |
| `PLUGIN_CONFIG_TYPE:<key>` | 配置类型或结构不合法 |
| `PLUGIN_CONFIG_OPTION:<key>` | select 值不在 options 中 |
| `PLUGIN_CONFIG_MIN/MAX:<key>` | 数字超出范围 |
| `PLUGIN_CONFIG_TOO_LARGE:<key>` | 结构化字段超过 128 KB |
| `PLUGIN_PERMISSION_DENIED:*` | 清单未声明所需权限 |
| `PLUGIN_REPLY_TARGET_UNAVAILABLE` | 当前事件无法自动推断回复目标 |
| `QQ_API_PATH_INVALID` | QQ 相对路径不安全 |
| `QQ_API_ENDPOINT_UNKNOWN` | `callEndpoint` ID 不存在 |
| `PLUGIN_HTTP_PRIVATE_ADDRESS_DENIED` | 外部 URL 指向本机、内网或保留地址 |
| `PLUGIN_HTTP_REQUEST_TOO_LARGE` | 外部请求体超过 32 KB |
| `PLUGIN_HTTP_RESPONSE_TOO_LARGE` | 外部响应超过 64 KB |
| `PLUGIN_KV_ENTRY_LIMIT` | 已达到 100 个记录 |
| `PLUGIN_KV_VALUE_TOO_LARGE` | 单记录超过 16 KB |
| `PLUGIN_KV_TOTAL_LIMIT` | 记录总量超过 128 KB |
| `PLUGIN_EXECUTION_TIMEOUT` | CPU 或墙钟时间超限 |

## 11. 完整开发与发布流程

1. 创建清单、入口脚本和可选配置页。
2. 运行最小单元测试，覆盖每个订阅事件、权限和错误分支。
3. 构建 ZIP，并确认清单和入口位于 ZIP 根目录预期路径。
4. 在“插件中心 -> 我的插件项目”导入版本。
5. 私有安装到自己的机器人，完成配置后再启用。
6. 在 QQ 开放平台确认机器人已开通所需事件和“接收所有消息”等能力。
7. 检查运行日志、Trace ID、外部 HTTP 失败和连续失败计数。
8. 提升 `version`，导入新版本并回归测试。
9. 申请市场审核；通过后该版本成为市场当前版本。

## 12. 官方参考

- [QQ 机器人 API v2](https://bot.q.qq.com/wiki/develop/api-v2/)
- [事件订阅与 Intents](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html)
- [消息收发概述](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html)
- [富媒体消息](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/rich-media.html)
- SDK 类型：`sdk/plugin/index.d.ts`
- 端点目录：`src/lib/qq-openapi-catalog.ts`
- 自定义配置页示例：`自定义回复/config.html`

旧版 `sdk/node`、`/api/plugins` 与 `/api/plugin-runtime/*` 长轮询接口仅供远程应用兼容。新插件应使用本手册描述的 `sdk/plugin` 托管模型。
