import { getPluginConfigPage } from "@/lib/hosted-plugin-service";
import { getSession } from "@/lib/session";

const bridgeBootstrap = String.raw`<script>
(() => {
  "use strict";
  const channel = "starbot.config.v1";
  const pending = new Map();
  let sequence = 0;
  function call(method, params, timeoutMs = 15000) {
    const id = "request-" + Date.now() + "-" + (++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("宿主响应超时"));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      parent.postMessage({ channel, direction: "request", id, method, params }, "*");
    });
  }
  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (!message || message.channel !== channel || message.direction !== "response" || typeof message.id !== "string") return;
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(typeof message.error === "string" ? message.error : "宿主操作失败"));
  });
  const records = Object.freeze({
    list: () => call("records.list"),
    set: (key, value) => call("records.set", { key, value }),
    delete: (key) => call("records.delete", { key }),
  });
  const api = Object.freeze({
    test: (definition, sample = {}) => call("api.test", { definition, sample }),
  });
  const runs = Object.freeze({
    list: (limit = 50) => call("runs.list", { limit }),
  });
  const assets = Object.freeze({
    list: () => call("assets.list"),
    upload: (name, mimeType, base64) => call("assets.upload", { name, mimeType, base64 }, 60000),
    delete: (id) => call("assets.delete", { id }),
  });
  Object.defineProperty(window, "StarBotConfig", {
    value: Object.freeze({
      getState: () => call("state.get"),
      saveConfig: (config) => call("config.save", { config }),
      records,
      api,
      runs,
      assets,
    }),
    writable: false,
    configurable: false,
  });
  dispatchEvent(new CustomEvent("starbot:config-ready"));
})();
</script>`;

function configPageDocument(html: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>插件配置</title>${bridgeBootstrap}</head><body>${html}</body></html>`;
}

export async function GET(_request: Request, context: { params: Promise<{ installationId: string }> }) {
  const user = await getSession();
  if (!user) return new Response("未登录或会话已失效", { status: 401 });
  try {
    const page = getPluginConfigPage(user, (await context.params).installationId);
    return new Response(configPageDocument(page.html), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; media-src https:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("配置页面不存在或无权访问", { status: 404 });
  }
}
