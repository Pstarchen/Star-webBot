export type StarBotEvent<T = unknown> = {
  id: string;
  type: string;
  botId: string;
  createdAt: string;
  data: T;
  attempt: number;
};

export type StarBotClientOptions = {
  platformUrl: string;
  pluginId: string;
  secret: string;
  fetch?: typeof globalThis.fetch;
};

export type QQOpenApiEndpointId = 'deleteChannel' | 'getChannel' | 'getGuild' | 'updateChannel' | 'getGateway' | 'listGuildChannels' | 'createGuildChannel' | 'acknowledgeInteraction' | 'generateUrlLink' | 'getBotProfile' | 'prepareGroupMediaUpload' | 'finishGroupMediaPart' | 'listBotGuilds' | 'approveGroupJoinRequest' | 'getBotGroupState' | 'listGroupJoinRequests' | 'getGroupInfo' | 'uploadGroupMedia' | 'sendGroupMessage' | 'recallGroupMessage' | 'getGroupMuteSettings' | 'setGroupMemberMute' | 'createGroupJoinApprovalStrategy' | 'listGroupJoinApprovalStrategies' | 'updateGroupJoinApprovalStrategy' | 'deleteGroupJoinApprovalStrategy' | 'executeGroupJoinApprovalStrategy' | 'finishC2CMediaPart' | 'updateGroupJoinApprovalWhitelist' | 'prepareC2CMediaUpload' | 'uploadC2CMedia' | 'sendC2CMessage' | 'recallC2CMessage' | 'sendC2CStreamMessage';
export type QQOpenApiQueryValue = string | number | bigint | boolean | null | undefined;
export type QQOpenApiQuery = Record<string, QQOpenApiQueryValue | readonly QQOpenApiQueryValue[]>;
export const QQ_OPENAPI_ENDPOINTS: Readonly<Record<QQOpenApiEndpointId, { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; title: string }>>;
export function resolveQQOpenApiEndpoint(endpointId: QQOpenApiEndpointId, pathParams?: Record<string, string | number | bigint>, query?: QQOpenApiQuery): { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; title: string };

export class StarBotHttpError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail: unknown);
}

export type StarBotEventHandler<T = unknown> = (event: StarBotEvent<T>, client: StarBotClient) => void | Promise<void>;

export class StarBotClient {
  constructor(options: StarBotClientOptions);
  pullEvents(options?: { limit?: number; waitMs?: number; signal?: AbortSignal }): Promise<{ leaseToken: string | null; leaseExpiresAt: string | null; events: StarBotEvent[] }>;
  ackEvents(leaseToken: string, deliveryIds: string[], options?: { signal?: AbortSignal }): Promise<{ acknowledged: number }>;
  callOpenApi(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  callEndpoint(endpointId: QQOpenApiEndpointId, pathParams?: Record<string, string | number | bigint>, body?: unknown, options?: { query?: QQOpenApiQuery; signal?: AbortSignal }): Promise<unknown>;
  sendC2C(userOpenid: string, payload: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  sendGroup(groupOpenid: string, payload: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  getBotProfile(options?: { signal?: AbortSignal }): Promise<unknown>;
  recallC2C(userOpenid: string, messageId: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  recallGroup(groupOpenid: string, messageId: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  getGroupMuteSettings(groupOpenid: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  muteGroupMember(groupOpenid: string, memberOpenid: string, muteExpireAt: string, options?: { operation?: 'add' | 'update'; signal?: AbortSignal }): Promise<unknown>;
  unmuteGroupMember(groupOpenid: string, memberOpenid: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  callMultipart(path: string, formData: FormData, options?: { signal?: AbortSignal }): Promise<unknown>;
  on<T = unknown>(eventType: string, handler: StarBotEventHandler<T>): this;
  off<T = unknown>(eventType: string, handler: StarBotEventHandler<T>): this;
  dispatch(event: StarBotEvent): Promise<void>;
  start(options?: { batchSize?: number; waitMs?: number; retryDelayMs?: number; signal?: AbortSignal }): Promise<void>;
  run(handler: StarBotEventHandler, options?: { batchSize?: number; waitMs?: number; retryDelayMs?: number; signal?: AbortSignal }): Promise<void>;
}
