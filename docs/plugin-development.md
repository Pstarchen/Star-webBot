# StarBot SDK 开发

用户扩展功能通过 SDK 应用实现，不需要填写开发者 Webhook URL，也不会获得机器人 Client Secret。平台通过机器人选定的 WebSocket 或 QQ 官方 Webhook 接收事件、持久化事件队列，并向 SDK 提供签名拉取、ACK 和受控 OpenAPI。

SDK 应用中的“订阅事件”只负责过滤平台已经接收到的事件，不会修改 QQ 开放平台后台订阅，也不会改变 WebSocket Identify 的 Intents。

## 创建 SDK 应用

1. 添加 QQ 机器人，并选择 WebSocket 或 QQ 官方 Webhook 接入。
2. 在“SDK 应用”中创建应用，选择订阅事件。
3. 需要主动调用 QQ API 时启用 `qq:api` 权限。
4. 保存只展示一次的应用 ID 和应用密钥。

## Node.js SDK

仓库内 SDK 位于 `sdk/node`，开发阶段可直接使用本地路径安装：

```powershell
npm install ./sdk/node
```

配置环境变量：

```env
STARBOT_PLATFORM_URL=http://localhost:3000
STARBOT_PLUGIN_ID=创建应用后显示的应用ID
STARBOT_PLUGIN_SECRET=创建应用后显示的应用密钥
```

消费事件：

```js
import { StarBotClient } from "@starbot/node-sdk";

const client = new StarBotClient({
  platformUrl: process.env.STARBOT_PLATFORM_URL,
  pluginId: process.env.STARBOT_PLUGIN_ID,
  secret: process.env.STARBOT_PLUGIN_SECRET,
});

client.on("*", (event) => console.log(event.type, event.data));
client.on("C2C_MESSAGE_CREATE", async (event, sdk) => {
    await sdk.sendC2C(event.data.author.user_openid, {
      content: "已收到",
      msg_type: 0,
      msg_id: event.data.id,
    });
});

await client.start();
```

可运行示例位于 `examples/sdk-app/index.mjs`。

## 事件可靠性

- SDK 默认长轮询 25 秒，无事件时不会频繁空转。
- 每批事件拥有 60 秒处理租约。
- `client.start` 在该事件的全部 `on` 处理器成功后逐条 ACK。
- 处理函数抛出异常或进程退出时不会 ACK，租约过期后事件重新投递。
- 每个事件最多领取 5 次，超过后进入失败状态，避免无限循环。
- `event.id` 是幂等键；涉及外部写操作时仍应在应用数据库中记录该 ID。

## SDK 请求认证

每次请求使用 HMAC-SHA256、毫秒时间戳和一次性 Nonce。签名原文为：

```text
<timestamp>.<nonce>.<rawBody>
```

平台允许 5 分钟时间偏差，Nonce 只能使用一次。SDK 已自动完成签名，不应自行保存或传递机器人 Secret。

## JSON OpenAPI

`client.callOpenApi(method, path, body)` 支持 `GET/POST/PUT/PATCH/DELETE`，相对路径可覆盖机器人已获授权的 QQ Bot API v2 REST 接口。消息接口也提供 `sendC2C` 和 `sendGroup` 快捷方法：

```js
await client.sendGroup("<group_openid>", {
  content: "群消息",
  msg_type: 0,
  msg_id: "触发消息ID",
});
```

平台负责 Access Token、凭据隔离、路径校验、限流和 QQ Trace ID 返回。

## multipart OpenAPI

使用 `client.callMultipart(path, formData)` 调用需要原始 `multipart/form-data` 的官方接口。SDK 对完全编码后的字节计算 SHA256，平台验签后流式转发，最大 201MB。

## 部署

SDK 应用可以运行在本机、容器、云函数或独立服务器，只需能够主动访问 StarBot 平台。SDK 使用出站 HTTPS 请求，不要求应用具有公网回调地址。

生产环境必须使用 HTTPS 平台地址，并通过进程环境变量或密钥管理服务提供应用密钥。不要把密钥提交到 Git、写入前端或输出到日志。
