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
  sendC2C(userOpenid: string, payload: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  sendGroup(groupOpenid: string, payload: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  callMultipart(path: string, formData: FormData, options?: { signal?: AbortSignal }): Promise<unknown>;
  on<T = unknown>(eventType: string, handler: StarBotEventHandler<T>): this;
  off<T = unknown>(eventType: string, handler: StarBotEventHandler<T>): this;
  dispatch(event: StarBotEvent): Promise<void>;
  start(options?: { batchSize?: number; waitMs?: number; retryDelayMs?: number; signal?: AbortSignal }): Promise<void>;
  run(handler: StarBotEventHandler, options?: { batchSize?: number; waitMs?: number; retryDelayMs?: number; signal?: AbortSignal }): Promise<void>;
}
