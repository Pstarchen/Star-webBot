import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StarBotClient, StarBotHttpError } from "../sdk/node/index.mjs";
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
    await client.sendC2C("user/open id", { content: "reply" });

    expect(received).toEqual(["typed:event-1", "all:event-1"]);
    expect(JSON.parse(requests[1].init.body)).toEqual({ method: "POST", path: "/v2/users/user%2Fopen%20id/messages", body: { content: "reply" } });
    const timestamp = requests[0].init.headers["X-StarBot-Timestamp"];
    const nonce = requests[0].init.headers["X-StarBot-Nonce"];
    const signature = createHmac("sha256", secret).update(`${timestamp}.${nonce}.${requests[0].init.body}`).digest("hex");
    expect(requests[0].init.headers["X-StarBot-Signature"]).toBe(`sha256=${signature}`);
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
});
