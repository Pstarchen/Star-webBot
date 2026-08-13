import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QQ_OPENAPI_ENDPOINTS, StarBotClient, StarBotHttpError, resolveQQOpenApiEndpoint } from "../sdk/node/index.mjs";
import { QQ_OPENAPI_ENDPOINTS as APP_QQ_OPENAPI_ENDPOINTS } from "../src/lib/qq-openapi-catalog.ts";
import { parseHostedPluginPackage } from "../src/lib/hosted-plugin-package.ts";
import { buildPluginPackage } from "../sdk/plugin/build.mjs";

describe("Node SDK", () => {
  it("signs requests, routes events, and exposes message helpers", async () => {
    const requests = [];
    const secret = "sdk-unit-test-secret";
    const fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      const body = JSON.parse(init.body);
      if (String(url).endsWith("/events/pull")) {
        return Response.json({ leaseToken: "lease-token-123456", leaseExpiresAt: new Date().toISOString(), events: [{ id: "event-1", type: "C2C_MESSAGE_CREATE", botId: "bot-1", createdAt: new Date().toISOString(), data: { content: "hello" }, attempt: 1 }] });
      }
      return Response.json({ body });
    };
    const client = new StarBotClient({ platformUrl: "https://console.example.com/", pluginId: "plugin-1", secret, fetch });

    const received = [];
    client.on("C2C_MESSAGE_CREATE", (event) => received.push(`typed:${event.id}`));
    client.on("*", (event) => received.push(`all:${event.id}`));
    const batch = await client.pullEvents({ waitMs: 0 });
    await client.dispatch(batch.events[0]);
    await client.getBotProfile();
    await client.sendC2C("user/open id", { content: "reply" });
    await client.sendGroup("group/open id", { content: "group reply" });
    await client.recallC2C("user/open id", "message/id");
    await client.recallGroup("group/open id", "message/id");
    await client.getGroupMuteSettings("group/open id");
    await client.muteGroupMember("group/open id", "member-openid", "2026-08-14T12:00:00+08:00");
    await client.unmuteGroupMember("group/open id", "member-openid");
    await client.callEndpoint("listGroupJoinRequests", { group_openid: "group/open id" }, undefined, { query: { limit: 20, cursor: "next page" } });

    expect(received).toEqual(["typed:event-1", "all:event-1"]);
    expect(JSON.parse(requests[1].init.body)).toEqual({ method: "GET", path: "/users/@me" });
    expect(JSON.parse(requests[2].init.body)).toEqual({ method: "POST", path: "/v2/users/user%2Fopen%20id/messages", body: { content: "reply" } });
    expect(JSON.parse(requests[3].init.body)).toEqual({ method: "POST", path: "/v2/groups/group%2Fopen%20id/messages", body: { content: "group reply" } });
    expect(JSON.parse(requests[4].init.body)).toEqual({ method: "DELETE", path: "/v2/users/user%2Fopen%20id/messages/message%2Fid" });
    expect(JSON.parse(requests[5].init.body)).toEqual({ method: "DELETE", path: "/v2/groups/group%2Fopen%20id/messages/message%2Fid" });
    expect(JSON.parse(requests[6].init.body)).toEqual({ method: "GET", path: "/v2/groups/group%2Fopen%20id/restrict_chat_setting" });
    expect(JSON.parse(requests[7].init.body)).toEqual({ method: "POST", path: "/v2/groups/group%2Fopen%20id/restrict_chat_setting", body: { members: [{ op: "add", member_openid: "member-openid", mute_expire_at: "2026-08-14T12:00:00+08:00" }] } });
    expect(JSON.parse(requests[8].init.body)).toEqual({ method: "POST", path: "/v2/groups/group%2Fopen%20id/restrict_chat_setting", body: { members: [{ op: "del", member_openid: "member-openid", mute_expire_at: "" }] } });
    expect(JSON.parse(requests[9].init.body)).toEqual({ method: "GET", path: "/v2/groups/group%2Fopen%20id/join_request_list?limit=20&cursor=next+page" });
    const timestamp = requests[0].init.headers["X-StarBot-Timestamp"];
    const nonce = requests[0].init.headers["X-StarBot-Nonce"];
    const signature = createHmac("sha256", secret).update(`${timestamp}.${nonce}.${requests[0].init.body}`).digest("hex");
    expect(requests[0].init.headers["X-StarBot-Signature"]).toBe(`sha256=${signature}`);
    expect(() => client.muteGroupMember("group", "member", "2026-08-14T12:00:00+08:00", { operation: "invalid" })).toThrow("operation must be add or update");
  });

  it("publishes the complete current generated OpenAPI catalog", () => {
    expect(Object.keys(QQ_OPENAPI_ENDPOINTS)).toHaveLength(42);
    expect(APP_QQ_OPENAPI_ENDPOINTS).toEqual(QQ_OPENAPI_ENDPOINTS);
    expect(resolveQQOpenApiEndpoint("recallGroupMessage", { group_openid: "group/id", message_id: "message/id" })).toEqual({
      method: "DELETE",
      path: "/v2/groups/group%2Fid/messages/message%2Fid",
      title: "撤回群聊消息",
    });
    expect(() => resolveQQOpenApiEndpoint("getGroupInfo", {})).toThrow("QQ_API_PATH_PARAM_REQUIRED:group_openid");
    expect(() => resolveQQOpenApiEndpoint("getBotProfile", { unused: "value" })).toThrow("QQ_API_PATH_PARAM_UNKNOWN:unused");
    expect(resolveQQOpenApiEndpoint("updateCommandPanelTarget", { panel_id: "panel/id" })).toEqual({
      method: "PUT",
      path: "/v2/panels/panel%2Fid/target",
      title: "修改指令面板关联对象",
    });
  });

  it("surfaces authentication failures as typed errors", async () => {
    const client = new StarBotClient({
      platformUrl: "https://console.example.com",
      pluginId: "plugin-1",
      secret: "invalid-secret",
      fetch: async () => Response.json({ message: "SDK 身份验证失败" }, { status: 401 }),
    });
    await expect(client.pullEvents({ waitMs: 0 })).rejects.toMatchObject({ name: "StarBotHttpError", status: 401 });
    await expect(client.pullEvents({ waitMs: 0 })).rejects.toBeInstanceOf(StarBotHttpError);
  });
});

describe("Hosted plugin SDK", () => {
  it("builds the example directory into an importable ZIP", () => {
    const output = path.join(os.tmpdir(), `starbot-plugin-sdk-${randomUUID()}.zip`);
    try {
      expect(buildPluginPackage(path.resolve(import.meta.dirname, "../examples/hosted-plugin"), output)).toBe(output);
      expect(fs.statSync(output).size).toBeGreaterThan(100);
    } finally {
      fs.rmSync(output, { force: true });
    }
  });

  it("builds the daily check-in test plugin", () => {
    const output = path.join(os.tmpdir(), `starbot-checkin-plugin-${randomUUID()}.zip`);
    try {
      expect(buildPluginPackage(path.resolve(import.meta.dirname, "../examples/checkin-plugin"), output)).toBe(output);
      expect(fs.statSync(output).size).toBeGreaterThan(300);
    } finally {
      fs.rmSync(output, { force: true });
    }
  });

  it("builds the group moderation plugin", () => {
    const output = path.join(os.tmpdir(), `starbot-group-moderation-${randomUUID()}.zip`);
    try {
      expect(buildPluginPackage(path.resolve(import.meta.dirname, "../examples/group-moderation-plugin"), output)).toBe(output);
      expect(fs.statSync(output).size).toBeGreaterThan(500);
      const parsed = parseHostedPluginPackage(fs.readFileSync(output));
      expect(parsed.manifest).toMatchObject({
        id: "group-member-moderation",
        version: "1.0.0",
        events: ["GROUP_AT_MESSAGE_CREATE"],
        permissions: ["reply:text", "qq:api", "log:write"],
      });
      expect(parsed.validation).toMatchObject({ fileCount: 3, scanner: "quickjs-isolated" });
    } finally {
      fs.rmSync(output, { force: true });
    }
  });
});
