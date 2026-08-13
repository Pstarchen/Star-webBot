export type StarBotEvent<T = Record<string, unknown>> = {
  type: string;
  botId: string;
  data: T;
};

export type StarBotPluginConfigValue = string | number | boolean;
export type StarBotQQApiResult<T = unknown> = { body: T; traceId: string | null };
export type QQOpenApiEndpointId = 'deleteChannel' | 'getChannel' | 'getGuild' | 'updateChannel' | 'getGateway' | 'listGuildChannels' | 'createGuildChannel' | 'acknowledgeInteraction' | 'generateUrlLink' | 'getBotProfile' | 'prepareGroupMediaUpload' | 'finishGroupMediaPart' | 'listBotGuilds' | 'approveGroupJoinRequest' | 'getBotGroupState' | 'listGroupJoinRequests' | 'getGroupInfo' | 'uploadGroupMedia' | 'sendGroupMessage' | 'recallGroupMessage' | 'getGroupMuteSettings' | 'setGroupMemberMute' | 'createGroupJoinApprovalStrategy' | 'listGroupJoinApprovalStrategies' | 'updateGroupJoinApprovalStrategy' | 'deleteGroupJoinApprovalStrategy' | 'executeGroupJoinApprovalStrategy' | 'finishC2CMediaPart' | 'updateGroupJoinApprovalWhitelist' | 'prepareC2CMediaUpload' | 'uploadC2CMedia' | 'sendC2CMessage' | 'recallC2CMessage' | 'sendC2CStreamMessage';
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
    callEndpoint<T = unknown>(endpointId: QQOpenApiEndpointId, pathParams?: Record<string, string | number | bigint>, body?: unknown, query?: QQOpenApiQuery): Promise<StarBotQQApiResult<T>>;
    sendC2C<T = unknown>(userOpenid: string, payload: unknown): Promise<StarBotQQApiResult<T>>;
    sendGroup<T = unknown>(groupOpenid: string, payload: unknown): Promise<StarBotQQApiResult<T>>;
    getBotProfile<T = unknown>(): Promise<StarBotQQApiResult<T>>;
    recallC2C<T = unknown>(userOpenid: string, messageId: string): Promise<StarBotQQApiResult<T>>;
    recallGroup<T = unknown>(groupOpenid: string, messageId: string): Promise<StarBotQQApiResult<T>>;
    getGroupMuteSettings<T = unknown>(groupOpenid: string): Promise<StarBotQQApiResult<T>>;
    muteGroupMember<T = unknown>(groupOpenid: string, memberOpenid: string, muteExpireAt: string, operation?: "add" | "update"): Promise<StarBotQQApiResult<T>>;
    unmuteGroupMember<T = unknown>(groupOpenid: string, memberOpenid: string): Promise<StarBotQQApiResult<T>>;
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

declare global {
  const StarBot: {
    definePlugin: typeof definePlugin;
  };
}
