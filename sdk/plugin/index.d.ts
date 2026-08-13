export type StarBotEvent<T = Record<string, unknown>> = {
  type: string;
  botId: string;
  data: T;
};

export type StarBotPluginConfigValue = string | number | boolean;

export type StarBotPluginSdk<TConfig extends Record<string, StarBotPluginConfigValue> = Record<string, StarBotPluginConfigValue>> = {
  readonly config: Readonly<TConfig>;
  readonly reply: {
    text(content: string): void;
    markdown(markdown: Record<string, unknown>): void;
    ark(ark: Record<string, unknown>): void;
    keyboard(keyboard: Record<string, unknown>): void;
  };
  readonly qq: {
    request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): void;
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
  onEvent(event: StarBotEvent, sdk: StarBotPluginSdk<TConfig>): void;
};

export function definePlugin<TConfig extends Record<string, StarBotPluginConfigValue>>(plugin: StarBotPlugin<TConfig>): StarBotPlugin<TConfig>;

declare global {
  const StarBot: {
    definePlugin: typeof definePlugin;
  };
}
