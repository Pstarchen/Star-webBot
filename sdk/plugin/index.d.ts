export type StarBotEvent<T = Record<string, unknown>> = {
  type: string;
  botId: string;
  data: T;
};

export type StarBotJsonValue = string | number | boolean | null | StarBotJsonValue[] | { [key: string]: StarBotJsonValue };
export type StarBotPluginConfigValue = StarBotJsonValue;
export type StarBotQQApiResult<T = unknown> = { body: T; traceId: string | null };
export type StarBotHttpResult<T = unknown> = { url: string; status: number; ok: boolean; headers: Record<string, string>; body: T };
export type QQOpenApiEndpointId = 'deleteChannel' | 'getChannel' | 'getGuild' | 'updateChannel' | 'getGateway' | 'listGuildChannels' | 'createGuildChannel' | 'acknowledgeInteraction' | 'generateUrlLink' | 'getGlobalMenu' | 'updateGlobalMenu' | 'createCommandPanel' | 'listCommandPanels' | 'deleteCommandPanel' | 'getCommandPanel' | 'updateCommandPanelTarget' | 'updateCommandPanel' | 'getBotProfile' | 'prepareGroupMediaUpload' | 'finishGroupMediaPart' | 'listBotGuilds' | 'approveGroupJoinRequest' | 'getBotGroupState' | 'listGroupJoinRequests' | 'getGroupInfo' | 'uploadGroupMedia' | 'sendGroupMessage' | 'recallGroupMessage' | 'getGroupMuteSettings' | 'setGroupMemberMute' | 'createGroupJoinApprovalStrategy' | 'listGroupJoinApprovalStrategies' | 'updateGroupJoinApprovalStrategy' | 'deleteGroupJoinApprovalStrategy' | 'executeGroupJoinApprovalStrategy' | 'finishC2CMediaPart' | 'updateGroupJoinApprovalWhitelist' | 'prepareC2CMediaUpload' | 'uploadC2CMedia' | 'sendC2CMessage' | 'recallC2CMessage' | 'sendC2CStreamMessage';
export type QQOpenApiQueryValue = string | number | bigint | boolean | null | undefined;
export type QQOpenApiQuery = Record<string, QQOpenApiQueryValue | readonly QQOpenApiQueryValue[]>;

export type StarBotPluginSdk<TConfig extends Record<string, StarBotPluginConfigValue> = Record<string, StarBotPluginConfigValue>> = {
  readonly config: Readonly<TConfig>;
  readonly reply: {
    text(content: string): void;
    markdown(markdown: Record<string, unknown>): void;
    ark(ark: Record<string, unknown>): void;
    keyboard(keyboard: Record<string, unknown>): void;
  };
  readonly qq: {
    request<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<StarBotQQApiResult<T>>;
    uploadMediaFromUrl<T = unknown>(targetType: "group" | "c2c", targetOpenid: string, fileType: 1 | 2 | 3 | 4, url: string, headers?: Record<string, string>): Promise<StarBotQQApiResult<T>>;
    callEndpoint<T = unknown>(endpointId: QQOpenApiEndpointId, pathParams?: Record<string, string | number | bigint>, body?: unknown, query?: QQOpenApiQuery): Promise<StarBotQQApiResult<T>>;
    sendC2C<T = unknown>(userOpenid: string, payload: unknown): Promise<StarBotQQApiResult<T>>;
    sendGroup<T = unknown>(groupOpenid: string, payload: unknown): Promise<StarBotQQApiResult<T>>;
    sendChannel<T = unknown>(channelId: string, payload: unknown): Promise<StarBotQQApiResult<T>>;
    sendDms<T = unknown>(guildId: string, payload: unknown): Promise<StarBotQQApiResult<T>>;
    getBotProfile<T = unknown>(): Promise<StarBotQQApiResult<T>>;
    recallC2C<T = unknown>(userOpenid: string, messageId: string): Promise<StarBotQQApiResult<T>>;
    recallGroup<T = unknown>(groupOpenid: string, messageId: string): Promise<StarBotQQApiResult<T>>;
    getGroupMuteSettings<T = unknown>(groupOpenid: string): Promise<StarBotQQApiResult<T>>;
    muteGroupMember<T = unknown>(groupOpenid: string, memberOpenid: string, muteExpireAt: string, operation?: "add" | "update"): Promise<StarBotQQApiResult<T>>;
    unmuteGroupMember<T = unknown>(groupOpenid: string, memberOpenid: string): Promise<StarBotQQApiResult<T>>;
  };
  readonly http: {
    request<T = unknown>(url: string, options?: {
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      responseMode?: "json" | "media";
      timeoutMs?: number;
      headers?: Record<string, string>;
      body?: unknown;
    }): Promise<StarBotHttpResult<T>>;
  };
  readonly kv: {
    get<T = unknown>(key: string, fallback?: T): T;
    set(key: string, value: unknown): void;
    delete(key: string): void;
  };
  readonly log: {
    debug(...parts: unknown[]): void;
    info(...parts: unknown[]): void;
    warn(...parts: unknown[]): void;
    error(...parts: unknown[]): void;
  };
  stopPropagation(): void;
};

export type StarBotPlugin<TConfig extends Record<string, StarBotPluginConfigValue> = Record<string, StarBotPluginConfigValue>> = {
  onEvent(event: StarBotEvent, sdk: StarBotPluginSdk<TConfig>): void | Promise<void>;
};

export function definePlugin<TConfig extends Record<string, StarBotPluginConfigValue>>(plugin: StarBotPlugin<TConfig>): StarBotPlugin<TConfig>;

export type StarBotConfigState<TConfig extends Record<string, StarBotPluginConfigValue> = Record<string, StarBotPluginConfigValue>> = {
  installation: { id: string; name: string; version: string; botId: string; botName: string };
  config: TConfig;
  configSchema: Array<Record<string, StarBotJsonValue | undefined>>;
  capabilities: { records: boolean; runs: boolean; apiTest: boolean; assets: boolean };
};

export type StarBotConfigRecord = { key: string; value: StarBotJsonValue; updatedAt: string };
export type StarBotConfigRun = {
  id: string;
  eventType: string;
  eventKey: string | null;
  status: "success" | "skipped" | "failed";
  durationMs: number;
  actionCount: number;
  logs: unknown[];
  error: string | null;
  createdAt: string;
};
export type StarBotConfigApiTestResult = {
  ok: boolean;
  status: number;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  extracted: unknown;
  durationMs: number;
};
export type StarBotConfigAsset = {
  id: string;
  mimeType: string;
  size: number;
  createdAt?: string;
  url: string;
};

export type StarBotConfigBridge<TConfig extends Record<string, StarBotPluginConfigValue> = Record<string, StarBotPluginConfigValue>> = {
  getState(): Promise<StarBotConfigState<TConfig>>;
  saveConfig(config: TConfig): Promise<{ ok: true; config: TConfig }>;
  records: {
    list(): Promise<{ records: StarBotConfigRecord[] }>;
    set(key: string, value: StarBotJsonValue): Promise<{ ok: true }>;
    delete(key: string): Promise<{ ok: true }>;
  };
  runs: {
    list(limit?: number): Promise<{ runs: StarBotConfigRun[] }>;
  };
  api: {
    test(
      definition: Record<string, unknown>,
      sample?: Record<string, string | number | boolean>,
    ): Promise<{ result: StarBotConfigApiTestResult }>;
  };
  assets: {
    list(): Promise<{ assets: StarBotConfigAsset[] }>;
    upload(name: string, mimeType: string, base64: string): Promise<{ asset: StarBotConfigAsset }>;
    delete(id: string): Promise<{ ok: true }>;
  };
};

declare global {
  const StarBot: {
    definePlugin: typeof definePlugin;
  };
  interface Window {
    readonly StarBotConfig: StarBotConfigBridge;
  }
}
