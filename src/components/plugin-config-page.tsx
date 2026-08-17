"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { formatApiError } from "@/lib/api-error";
import type { HostedPluginConfigValue, HostedPluginInstallation } from "@/types/platform";

const CHANNEL = "starbot.config.v1";
const REQUEST_ID = /^request-\d{1,20}-\d{1,10}$/;

type BridgeRequest = {
  channel: typeof CHANNEL;
  direction: "request";
  id: string;
  method: string;
  params?: unknown;
};

type PluginConfigPageProps = {
  installation: HostedPluginInstallation;
  config: Record<string, HostedPluginConfigValue>;
  onConfigSaved: (config: Record<string, HostedPluginConfigValue>) => Promise<void>;
  onError: (message: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function responseJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(formatApiError(body));
  return body;
}

export function PluginConfigPage({ installation, config, onConfigSaved, onError }: PluginConfigPageProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const bridgeState = useRef({ installation, config, onConfigSaved, onError });
  const [loadedInstallationId, setLoadedInstallationId] = useState<string | null>(null);
  const loaded = loadedInstallationId === installation.id;

  useEffect(() => {
    bridgeState.current = { installation, config, onConfigSaved, onError };
  }, [config, installation, onConfigSaved, onError]);

  useEffect(() => {
    const recordsUrl = `/api/plugin-installations/${installation.id}/records`;
    const runsUrl = `/api/plugin-installations/${installation.id}/runs`;
    const apiTestUrl = `/api/plugin-installations/${installation.id}/api-test`;
    const assetsUrl = `/api/plugin-installations/${installation.id}/assets`;

    async function handleRequest(request: BridgeRequest) {
      const current = bridgeState.current;
      if (request.method === "state.get") {
        return {
          installation: {
            id: current.installation.id,
            name: current.installation.name,
            version: current.installation.version,
            botId: current.installation.botId,
            botName: current.installation.botName,
          },
          config: current.config,
          configSchema: current.installation.configSchema,
          capabilities: {
            records: current.installation.permissions.includes("storage:kv"),
            runs: current.installation.permissions.includes("log:write"),
            apiTest: current.installation.permissions.includes("http:request"),
            assets: current.installation.permissions.includes("qq:api"),
          },
        };
      }
      if (request.method === "config.save") {
        const params = isRecord(request.params) ? request.params : {};
        if (!isRecord(params.config)) throw new Error("配置必须是对象");
        const serialized = JSON.stringify(params.config);
        if (serialized.length > 256 * 1024) throw new Error("配置内容过大");
        const nextConfig = params.config as Record<string, HostedPluginConfigValue>;
        await responseJson(`/api/plugin-installations/${current.installation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: nextConfig }),
        });
        await current.onConfigSaved(nextConfig);
        return { ok: true, config: nextConfig };
      }
      if (request.method === "records.list") return responseJson(recordsUrl);
      if (request.method === "records.set") {
        const params = isRecord(request.params) ? request.params : {};
        await responseJson(recordsUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: params.key, value: params.value }),
        });
        return { ok: true };
      }
      if (request.method === "records.delete") {
        const params = isRecord(request.params) ? request.params : {};
        await responseJson(recordsUrl, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: params.key }),
        });
        return { ok: true };
      }
      if (request.method === "runs.list") {
        const params = isRecord(request.params) ? request.params : {};
        const limit = Number(params.limit ?? 50);
        return responseJson(`${runsUrl}?limit=${encodeURIComponent(String(Number.isFinite(limit) ? limit : 50))}`);
      }
      if (request.method === "api.test") {
        const params = isRecord(request.params) ? request.params : {};
        if (!isRecord(params.definition) || !isRecord(params.sample)) throw new Error("API 测试参数不合法");
        return responseJson(apiTestUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ definition: params.definition, sample: params.sample }),
        });
      }
      if (request.method === "assets.list") return responseJson(assetsUrl);
      if (request.method === "assets.upload") {
        const params = isRecord(request.params) ? request.params : {};
        if (typeof params.name !== "string" || typeof params.mimeType !== "string" || typeof params.base64 !== "string") throw new Error("媒体上传参数不合法");
        return responseJson(assetsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: params.name, mimeType: params.mimeType, base64: params.base64 }),
        });
      }
      if (request.method === "assets.delete") {
        const params = isRecord(request.params) ? request.params : {};
        if (typeof params.id !== "string") throw new Error("媒体删除参数不合法");
        return responseJson(assetsUrl, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: params.id }),
        });
      }
      throw new Error("不支持的配置页操作");
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const request = event.data as Partial<BridgeRequest> | null;
      if (!request || request.channel !== CHANNEL || request.direction !== "request" || typeof request.id !== "string" || !REQUEST_ID.test(request.id) || typeof request.method !== "string") return;
      void handleRequest(request as BridgeRequest).then(
        (result) => frameRef.current?.contentWindow?.postMessage({ channel: CHANNEL, direction: "response", id: request.id, ok: true, result }, "*"),
        (error) => {
          const message = error instanceof Error ? error.message : "配置页操作失败";
          bridgeState.current.onError(message);
          frameRef.current?.contentWindow?.postMessage({ channel: CHANNEL, direction: "response", id: request.id, ok: false, error: message }, "*");
        },
      );
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [installation.id]);

  return (
    <div className="relative overflow-hidden rounded-md border bg-background" style={{ minHeight: installation.configPage?.height || 720 }}>
      {!loaded && <div className="absolute inset-0 grid place-items-center bg-background text-muted-foreground"><LoaderCircle size={20} className="animate-spin" aria-label="正在加载插件配置页面" /></div>}
      <iframe
        ref={frameRef}
        src={`/api/plugin-installations/${installation.id}/config-page`}
        title={`${installation.name} 配置页面`}
        sandbox="allow-scripts"
        className="block w-full border-0 bg-white"
        style={{ height: installation.configPage?.height || 720 }}
        onLoad={() => setLoadedInstallationId(installation.id)}
      />
    </div>
  );
}
