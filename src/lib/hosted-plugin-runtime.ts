import "server-only";
import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";
import { z } from "zod";

const MAX_EXECUTION_MS = 150;
const MAX_ACTIONS = 12;
const MAX_LOGS = 30;
const MAX_JSON_BYTES = 64 * 1024;

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
  const state = { plugin: null };
  const clone = (value) => safeParse(safeStringify(value));
  const definePlugin = (plugin) => {
    if (state.plugin) throw new Error("StarBot.definePlugin can only be called once");
    if (!plugin || typeof plugin.onEvent !== "function") throw new Error("Plugin must define onEvent(event, sdk)");
    state.plugin = safeFreeze(plugin);
  };
  const execute = (eventJson, configJson, kvJson) => {
    if (!state.plugin) throw new Error("Plugin did not call StarBot.definePlugin");
    const event = safeFreeze(safeParse(eventJson));
    const config = safeFreeze(safeParse(configJson));
    const kv = safeParse(kvJson);
    const actions = [];
    const logs = [];
    let stopped = false;
    const addAction = (action) => {
      if (actions.length >= ${MAX_ACTIONS}) throw new Error("Plugin action limit exceeded");
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
        request(method, path, body) { addAction({ kind: "qq_api", method: String(method).toUpperCase(), path: String(path), body }); }
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
    const returned = state.plugin.onEvent(event, sdk);
    if (returned && typeof returned.then === "function") throw new Error("Async plugin handlers are not supported");
    return clone({ actions, logs, stopPropagation: stopped });
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

export async function executeHostedPlugin(input: {
  code: string;
  event: unknown;
  config: Record<string, unknown>;
  kv: Record<string, unknown>;
}): Promise<HostedPluginRuntimeResult> {
  const startedAt = performance.now();
  const deadline = Date.now() + MAX_EXECUTION_MS;
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const context = runtime.newContext();

  try {
    for (const [source, filename] of [[bootstrapCode, "starbot-sdk.js"], [`"use strict";\n${input.code}`, "plugin.js"]] as const) {
      const evaluation = context.evalCode(source, filename);
      if (evaluation.error) {
        const dumped = context.dump(evaluation.error);
        evaluation.error.dispose();
        throw new Error(Date.now() >= deadline ? "PLUGIN_EXECUTION_TIMEOUT" : `PLUGIN_CODE_ERROR:${guestError(dumped)}`);
      }
      evaluation.value.dispose();
    }

    const invocation = context.evalCode(`__starbotExecute(${jsonForGuest(input.event)}, ${jsonForGuest(input.config)}, ${jsonForGuest(input.kv)})`, "starbot-event.js");
    if (invocation.error) {
      const dumped = context.dump(invocation.error);
      invocation.error.dispose();
      throw new Error(Date.now() >= deadline ? "PLUGIN_EXECUTION_TIMEOUT" : `PLUGIN_RUNTIME_ERROR:${guestError(dumped)}`);
    }
    const dumped = context.dump(invocation.value);
    invocation.value.dispose();
    const parsed = runtimeOutputSchema.safeParse(dumped);
    if (!parsed.success) throw new Error(`PLUGIN_RUNTIME_OUTPUT_INVALID:${parsed.error.issues[0]?.message || "unknown"}`);
    if (Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > MAX_JSON_BYTES) throw new Error("PLUGIN_RUNTIME_OUTPUT_TOO_LARGE");
    return { ...parsed.data, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) };
  } finally {
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
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
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
  maxActions: MAX_ACTIONS,
  maxLogs: MAX_LOGS,
  memoryBytes: 16 * 1024 * 1024,
};
