import "server-only";
import { getQuickJS } from "quickjs-emscripten";
import { z } from "zod";
import { QQ_OPENAPI_ENDPOINTS } from "@/lib/qq-openapi-catalog";
import type { PluginHttpRequest } from "@/lib/plugin-http";

const MAX_EXECUTION_MS = 150;
const MAX_WALL_TIME_MS = 30_000;
const MAX_ACTIONS = 12;
const MAX_LOGS = 30;
const MAX_JSON_BYTES = 64 * 1024;
const endpointCatalogJson = JSON.stringify(QQ_OPENAPI_ENDPOINTS);

const replyActionSchema = z.discriminatedUnion("format", [
  z.object({ kind: z.literal("reply"), format: z.literal("text"), content: z.string().min(1).max(2_000) }),
  z.object({ kind: z.literal("reply"), format: z.literal("markdown"), markdown: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal("reply"), format: z.literal("ark"), ark: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal("reply"), format: z.literal("keyboard"), keyboard: z.record(z.string(), z.unknown()) }),
]);

const pluginActionSchema = z.discriminatedUnion("kind", [
  replyActionSchema,
  z.object({
    kind: z.literal("qq_api"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().min(1).max(500),
    body: z.unknown().optional(),
  }),
  z.object({ kind: z.literal("kv_set"), key: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/), value: z.unknown() }),
  z.object({ kind: z.literal("kv_delete"), key: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/) }),
]);

const runtimeOutputSchema = z.object({
  actions: z.array(pluginActionSchema).max(MAX_ACTIONS),
  logs: z.array(z.object({ level: z.enum(["debug", "info", "warn", "error"]), message: z.string().max(1_000) })).max(MAX_LOGS),
  qqRequestCount: z.number().int().min(0).max(MAX_ACTIONS),
  httpRequestCount: z.number().int().min(0).max(MAX_ACTIONS),
  stopPropagation: z.boolean(),
});

export type HostedPluginAction = z.infer<typeof pluginActionSchema>;
export type HostedPluginRuntimeResult = z.infer<typeof runtimeOutputSchema> & { durationMs: number };

const bootstrapCode = `(() => {
  "use strict";
  const safeParse = JSON.parse.bind(JSON);
  const safeStringify = JSON.stringify.bind(JSON);
  const safePush = Function.call.bind(Array.prototype.push);
  const safeFreeze = Object.freeze.bind(Object);
  const safeHasOwn = Function.call.bind(Object.prototype.hasOwnProperty);
  const endpointCatalog = safeFreeze(${endpointCatalogJson});
  const state = { plugin: null };
  const clone = (value) => safeParse(safeStringify(value));
  const definePlugin = (plugin) => {
    if (state.plugin) throw new Error("StarBot.definePlugin can only be called once");
    if (!plugin || typeof plugin.onEvent !== "function") throw new Error("Plugin must define onEvent(event, sdk)");
    state.plugin = safeFreeze(plugin);
  };
  const execute = async (eventJson, configJson, kvJson) => {
    if (!state.plugin) throw new Error("Plugin did not call StarBot.definePlugin");
    const event = safeFreeze(safeParse(eventJson));
    const config = safeFreeze(safeParse(configJson));
    const kv = safeParse(kvJson);
    const actions = [];
    const logs = [];
    const pendingQQRequests = [];
    const pendingHTTPRequests = [];
    let operationCount = 0;
    let stopped = false;
    const reserveOperation = () => {
      operationCount += 1;
      if (operationCount > ${MAX_ACTIONS}) throw new Error("Plugin action limit exceeded");
    };
    const addAction = (action) => {
      reserveOperation();
      safePush(actions, safeFreeze(clone(action)));
    };
    const addLog = (level, parts) => {
      if (logs.length >= ${MAX_LOGS}) return;
      const message = parts.map((part) => typeof part === "string" ? part : safeStringify(part)).join(" ").slice(0, 1000);
      safePush(logs, safeFreeze({ level, message }));
    };
    const sdk = safeFreeze({
      config,
      reply: safeFreeze({
        text(content) { addAction({ kind: "reply", format: "text", content: String(content) }); },
        markdown(markdown) { addAction({ kind: "reply", format: "markdown", markdown }); },
        ark(ark) { addAction({ kind: "reply", format: "ark", ark }); },
        keyboard(keyboard) { addAction({ kind: "reply", format: "keyboard", keyboard }); }
      }),
      qq: safeFreeze({
        request(method, path, body) {
          reserveOperation();
          const request = { kind: "qq_api", method: String(method).toUpperCase(), path: String(path), body };
          if (typeof __starbotQQRequest !== "function") {
            safePush(actions, safeFreeze(clone(request)));
            return Promise.resolve({ body: null, traceId: null });
          }
          const pending = __starbotQQRequest(safeStringify(request)).then((resultJson) => safeParse(resultJson));
          const tracked = { observed: false, promise: pending };
          safePush(pendingQQRequests, tracked);
          return safeFreeze({
            then(onFulfilled, onRejected) { tracked.observed = true; return pending.then(onFulfilled, onRejected); },
            catch(onRejected) { tracked.observed = true; return pending.catch(onRejected); },
            finally(onFinally) { tracked.observed = true; return pending.finally(onFinally); }
          });
        },
        callEndpoint(endpointId, pathParams = {}, body, query = {}) {
          const endpoint = endpointCatalog[String(endpointId)];
          if (!endpoint) throw new Error("QQ_API_ENDPOINT_UNKNOWN");
          const required = [];
          let path = endpoint.path.replace(/\{([a-z_]+)\}/g, (_match, name) => {
            safePush(required, name);
            if (!safeHasOwn(pathParams, name) || String(pathParams[name]).length === 0) throw new Error("QQ_API_PATH_PARAM_REQUIRED:" + name);
            return encodeURIComponent(String(pathParams[name]));
          });
          const unknownParam = Object.keys(pathParams).find((name) => !required.includes(name));
          if (unknownParam) throw new Error("QQ_API_PATH_PARAM_UNKNOWN:" + unknownParam);
          const queryParts = [];
          Object.keys(query).forEach((name) => {
            const values = Array.isArray(query[name]) ? query[name] : [query[name]];
            values.forEach((value) => {
              if (value !== undefined && value !== null) safePush(queryParts, encodeURIComponent(name) + "=" + encodeURIComponent(String(value)));
            });
          });
          if (queryParts.length) path += "?" + queryParts.join("&");
          return this.request(endpoint.method, path, body);
        },
        sendC2C(userOpenid, payload) { return this.request("POST", "/v2/users/" + encodeURIComponent(String(userOpenid)) + "/messages", payload); },
        sendGroup(groupOpenid, payload) { return this.request("POST", "/v2/groups/" + encodeURIComponent(String(groupOpenid)) + "/messages", payload); },
        sendChannel(channelId, payload) { return this.request("POST", "/channels/" + encodeURIComponent(String(channelId)) + "/messages", payload); },
        sendDms(guildId, payload) { return this.request("POST", "/dms/" + encodeURIComponent(String(guildId)) + "/messages", payload); },
        getBotProfile() { return this.request("GET", "/users/@me"); },
        recallC2C(userOpenid, messageId) { return this.request("DELETE", "/v2/users/" + encodeURIComponent(String(userOpenid)) + "/messages/" + encodeURIComponent(String(messageId))); },
        recallGroup(groupOpenid, messageId) { return this.request("DELETE", "/v2/groups/" + encodeURIComponent(String(groupOpenid)) + "/messages/" + encodeURIComponent(String(messageId))); },
        getGroupMuteSettings(groupOpenid) { return this.request("GET", "/v2/groups/" + encodeURIComponent(String(groupOpenid)) + "/restrict_chat_setting"); },
        muteGroupMember(groupOpenid, memberOpenid, muteExpireAt, operation = "add") {
          if (operation !== "add" && operation !== "update") throw new TypeError("operation must be add or update");
          return this.request("POST", "/v2/groups/" + encodeURIComponent(String(groupOpenid)) + "/restrict_chat_setting", { members: [{ op: operation, member_openid: String(memberOpenid), mute_expire_at: String(muteExpireAt) }] });
        },
        unmuteGroupMember(groupOpenid, memberOpenid) { return this.request("POST", "/v2/groups/" + encodeURIComponent(String(groupOpenid)) + "/restrict_chat_setting", { members: [{ op: "del", member_openid: String(memberOpenid), mute_expire_at: "" }] }); }
      }),
      http: safeFreeze({
        request(url, options = {}) {
          reserveOperation();
          if (typeof __starbotHTTPRequest !== "function") return Promise.reject(new Error("HTTP_REQUEST_UNAVAILABLE"));
            const request = {
              url: String(url),
              method: String(options.method || "GET").toUpperCase(),
              ...(options.responseMode === "media" ? { responseMode: "media" } : {}),
              headers: options.headers,
              body: options.body
            };
          const pending = __starbotHTTPRequest(safeStringify(request)).then((resultJson) => safeParse(resultJson));
          const tracked = { observed: false, promise: pending };
          safePush(pendingHTTPRequests, tracked);
          return safeFreeze({
            then(onFulfilled, onRejected) { tracked.observed = true; return pending.then(onFulfilled, onRejected); },
            catch(onRejected) { tracked.observed = true; return pending.catch(onRejected); },
            finally(onFinally) { tracked.observed = true; return pending.finally(onFinally); }
          });
        }
      }),
      kv: safeFreeze({
        get(key, fallback = null) { return safeHasOwn(kv, String(key)) ? clone(kv[String(key)]) : fallback; },
        set(key, value) { kv[String(key)] = clone(value); addAction({ kind: "kv_set", key: String(key), value }); },
        delete(key) { delete kv[String(key)]; addAction({ kind: "kv_delete", key: String(key) }); }
      }),
      log: safeFreeze({
        debug(...parts) { addLog("debug", parts); },
        info(...parts) { addLog("info", parts); },
        warn(...parts) { addLog("warn", parts); },
        error(...parts) { addLog("error", parts); }
      }),
      stopPropagation() { stopped = true; }
    });
    await state.plugin.onEvent(event, sdk);
    const pendingRequests = pendingQQRequests.concat(pendingHTTPRequests);
    const settlements = await Promise.all(pendingRequests.map(async (request) => {
      try { await request.promise; return safeFreeze({ ok: true, observed: request.observed }); }
      catch (error) { return safeFreeze({ ok: false, observed: request.observed, error }); }
    }));
    const unhandled = settlements.find((settlement) => !settlement.ok && !settlement.observed);
    if (unhandled) throw unhandled.error;
    return clone({ actions, logs, qqRequestCount: pendingQQRequests.length, httpRequestCount: pendingHTTPRequests.length, stopPropagation: stopped });
  };
  Object.defineProperty(globalThis, "StarBot", { value: safeFreeze({ definePlugin }), writable: false, configurable: false });
  Object.defineProperty(globalThis, "__starbotExecute", { value: execute, writable: false, configurable: false });
  Object.defineProperty(globalThis, "__starbotValidate", { value: () => Boolean(state.plugin), writable: false, configurable: false });
})();`;

function jsonForGuest(value: unknown) {
  const json = JSON.stringify(value ?? null);
  if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) throw new Error("PLUGIN_RUNTIME_INPUT_TOO_LARGE");
  return JSON.stringify(json);
}

function guestError(value: unknown) {
  if (!value || typeof value !== "object") return String(value || "Plugin execution failed");
  const error = value as { name?: unknown; message?: unknown; stack?: unknown };
  return [error.name, error.message].filter((item) => typeof item === "string" && item).join(": ") || "Plugin execution failed";
}

function runtimeError(value: unknown) {
  const message = guestError(value);
  const stableCode = message.match(/PLUGIN_PERMISSION_DENIED:[A-Za-z0-9:._-]+/)?.[0];
  return stableCode || `PLUGIN_RUNTIME_ERROR:${message}`;
}

export async function executeHostedPlugin(input: {
  code: string;
  event: unknown;
  config: Record<string, unknown>;
  kv: Record<string, unknown>;
  qqRequest?: (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body: unknown, signal: AbortSignal) => Promise<unknown>;
  httpRequest?: (request: PluginHttpRequest, signal: AbortSignal) => Promise<unknown>;
}): Promise<HostedPluginRuntimeResult> {
  const startedAt = performance.now();
  let executionDeadline = Date.now() + MAX_EXECUTION_MS;
  let disposed = false;
  const abortController = new AbortController();
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  runtime.setInterruptHandler(() => Date.now() >= executionDeadline);
  const context = runtime.newContext();
  let rejectPendingJobFailure: (error: Error) => void = () => undefined;
  const pendingJobFailure = new Promise<never>((_, reject) => { rejectPendingJobFailure = reject; });

  function executePendingJobs() {
    const result = runtime.executePendingJobs();
    if (!result.error) return;
    const dumped = result.error.context.dump(result.error);
    result.error.dispose();
    rejectPendingJobFailure(new Error(Date.now() >= executionDeadline ? "PLUGIN_EXECUTION_TIMEOUT" : runtimeError(dumped)));
  }

  try {
    if (input.qqRequest) {
      const qqRequestHandle = context.newFunction("__starbotQQRequest", (requestJsonHandle) => {
        const deferred = context.newPromise();
        const requestJson = context.getString(requestJsonHandle);
        void (async () => {
          try {
            const request = JSON.parse(requestJson) as { method?: unknown; path?: unknown; body?: unknown };
            if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(request.method))) throw new Error("QQ_API_METHOD_INVALID");
            const result = await input.qqRequest!(request.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE", String(request.path || ""), request.body, abortController.signal);
            if (disposed) return;
            const resultJson = JSON.stringify(result ?? null);
            if (Buffer.byteLength(resultJson, "utf8") > MAX_JSON_BYTES) throw new Error("PLUGIN_QQ_RESPONSE_TOO_LARGE");
            const resultHandle = context.newString(resultJson);
            deferred.resolve(resultHandle);
            resultHandle.dispose();
          } catch (error) {
            if (disposed) return;
            const source = error instanceof Error ? error : new Error("QQ_API_REQUEST_FAILED");
            const errorHandle = context.newError(source.message);
            context.newString(source.name).consume((handle) => context.setProp(errorHandle, "name", handle));
            if ("status" in source && typeof source.status === "number") context.newNumber(source.status).consume((handle) => context.setProp(errorHandle, "status", handle));
            if ("traceId" in source && typeof source.traceId === "string") context.newString(source.traceId).consume((handle) => context.setProp(errorHandle, "traceId", handle));
            deferred.reject(errorHandle);
            errorHandle.dispose();
          } finally {
            if (!disposed) {
              executionDeadline = Date.now() + MAX_EXECUTION_MS;
              executePendingJobs();
            }
          }
        })();
        return deferred.handle;
      });
      context.setProp(context.global, "__starbotQQRequest", qqRequestHandle);
      qqRequestHandle.dispose();
    }

    if (input.httpRequest) {
      const httpRequestHandle = context.newFunction("__starbotHTTPRequest", (requestJsonHandle) => {
        const deferred = context.newPromise();
        const requestJson = context.getString(requestJsonHandle);
        void (async () => {
          try {
            if (Buffer.byteLength(requestJson, "utf8") > MAX_JSON_BYTES) throw new Error("PLUGIN_HTTP_REQUEST_TOO_LARGE");
            const request = JSON.parse(requestJson) as PluginHttpRequest;
            const result = await input.httpRequest!(request, abortController.signal);
            if (disposed) return;
            const resultJson = JSON.stringify(result ?? null);
            if (Buffer.byteLength(resultJson, "utf8") > MAX_JSON_BYTES) throw new Error("PLUGIN_HTTP_RESPONSE_TOO_LARGE");
            const resultHandle = context.newString(resultJson);
            deferred.resolve(resultHandle);
            resultHandle.dispose();
          } catch (error) {
            if (disposed) return;
            const source = error instanceof Error ? error : new Error("PLUGIN_HTTP_REQUEST_FAILED");
            const errorHandle = context.newError(source.message);
            context.newString(source.name).consume((handle) => context.setProp(errorHandle, "name", handle));
            deferred.reject(errorHandle);
            errorHandle.dispose();
          } finally {
            if (!disposed) {
              executionDeadline = Date.now() + MAX_EXECUTION_MS;
              executePendingJobs();
            }
          }
        })();
        return deferred.handle;
      });
      context.setProp(context.global, "__starbotHTTPRequest", httpRequestHandle);
      httpRequestHandle.dispose();
    }

    for (const [source, filename] of [[bootstrapCode, "starbot-sdk.js"], [`"use strict";\n${input.code}`, "plugin.js"]] as const) {
      executionDeadline = Date.now() + MAX_EXECUTION_MS;
      const evaluation = context.evalCode(source, filename);
      if (evaluation.error) {
        const dumped = context.dump(evaluation.error);
        evaluation.error.dispose();
        throw new Error(Date.now() >= executionDeadline ? "PLUGIN_EXECUTION_TIMEOUT" : `PLUGIN_CODE_ERROR:${guestError(dumped)}`);
      }
      evaluation.value.dispose();
    }

    executionDeadline = Date.now() + MAX_EXECUTION_MS;
    const invocation = context.evalCode(`__starbotExecute(${jsonForGuest(input.event)}, ${jsonForGuest(input.config)}, ${jsonForGuest(input.kv)})`, "starbot-event.js");
    if (invocation.error) {
      const dumped = context.dump(invocation.error);
      invocation.error.dispose();
      throw new Error(Date.now() >= executionDeadline ? "PLUGIN_EXECUTION_TIMEOUT" : runtimeError(dumped));
    }
    const resolvedPromise = context.resolvePromise(invocation.value);
    invocation.value.dispose();
    executionDeadline = Date.now() + MAX_EXECUTION_MS;
    executePendingJobs();
    let wallTimer: ReturnType<typeof setTimeout> | undefined;
    const wallTimeout = new Promise<never>((_, reject) => {
      wallTimer = setTimeout(() => reject(new Error("PLUGIN_EXECUTION_WALL_TIMEOUT")), MAX_WALL_TIME_MS);
      wallTimer.unref?.();
    });
    const resolved = await Promise.race([resolvedPromise, pendingJobFailure, wallTimeout]).finally(() => {
      if (wallTimer) clearTimeout(wallTimer);
    });
    if (resolved.error) {
      const dumpedError = context.dump(resolved.error);
      resolved.error.dispose();
      throw new Error(Date.now() >= executionDeadline ? "PLUGIN_EXECUTION_TIMEOUT" : runtimeError(dumpedError));
    }
    const dumped = context.dump(resolved.value);
    resolved.value.dispose();
    const parsed = runtimeOutputSchema.safeParse(dumped);
    if (!parsed.success) throw new Error(`PLUGIN_RUNTIME_OUTPUT_INVALID:${parsed.error.issues[0]?.message || "unknown"}`);
    if (Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > MAX_JSON_BYTES) throw new Error("PLUGIN_RUNTIME_OUTPUT_TOO_LARGE");
    return { ...parsed.data, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) };
  } finally {
    disposed = true;
    abortController.abort();
    context.dispose();
    runtime.dispose();
  }
}

export async function validateHostedPluginCode(code: string) {
  const deadline = Date.now() + MAX_EXECUTION_MS;
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const context = runtime.newContext();
  try {
    for (const [source, filename] of [[bootstrapCode, "starbot-sdk.js"], [`"use strict";\n${code}`, "plugin.js"]] as const) {
      const evaluation = context.evalCode(source, filename);
      if (evaluation.error) {
        const dumped = context.dump(evaluation.error);
        evaluation.error.dispose();
        throw new Error(Date.now() >= deadline ? "PLUGIN_EXECUTION_TIMEOUT" : `PLUGIN_CODE_ERROR:${guestError(dumped)}`);
      }
      evaluation.value.dispose();
    }
    const validation = context.evalCode("__starbotValidate()", "starbot-validation.js");
    if (validation.error) {
      const dumped = context.dump(validation.error);
      validation.error.dispose();
      throw new Error(`PLUGIN_CODE_ERROR:${guestError(dumped)}`);
    }
    const valid = context.dump(validation.value);
    validation.value.dispose();
    if (valid !== true) throw new Error("PLUGIN_DEFINITION_MISSING");
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

export const hostedPluginRuntimeLimits = {
  executionMs: MAX_EXECUTION_MS,
  wallTimeMs: MAX_WALL_TIME_MS,
  maxActions: MAX_ACTIONS,
  maxLogs: MAX_LOGS,
  memoryBytes: 16 * 1024 * 1024,
};
