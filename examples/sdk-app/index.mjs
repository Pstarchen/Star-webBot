import { StarBotClient } from "../../sdk/node/index.mjs";

const platformUrl = process.env.STARBOT_PLATFORM_URL || "http://localhost:3000";
const pluginId = process.env.STARBOT_PLUGIN_ID;
const secret = process.env.STARBOT_PLUGIN_SECRET;
if (!pluginId || !secret) throw new Error("STARBOT_PLUGIN_ID and STARBOT_PLUGIN_SECRET are required");

const client = new StarBotClient({ platformUrl, pluginId, secret });

client.on("*", (event) => console.log(`[${event.type}]`, event.data));
client.on("C2C_MESSAGE_CREATE", async (event, sdk) => {
  if (event.data?.author?.user_openid) {
    await sdk.sendC2C(event.data.author.user_openid, {
      content: "SDK 应用已收到你的消息",
      msg_type: 0,
      msg_id: event.data.id,
    });
  }
});

await client.start();
