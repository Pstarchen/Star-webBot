import "server-only";
import { lookup as lookupDns } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";

const MAX_URL_LENGTH = 2_000;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_HEADERS = 20;
const MAX_REDIRECTS = 3;

export type PluginHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type PluginHttpRequest = {
  url: string;
  method?: PluginHttpMethod;
  responseMode?: "json" | "media";
  headers?: Record<string, string>;
  body?: unknown;
};
export type PluginHttpResponse = {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown;
};

type LookupResult = { address: string; family: number };
type PluginHttpDependencies = {
  fetch?: typeof fetch;
  lookup?: (hostname: string) => Promise<LookupResult[]>;
};

function isBlockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isBlockedAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return isBlockedIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized.startsWith("::ffff:")) return isBlockedIpv4(normalized.slice(7));
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8:");
}

function parseUrl(value: string) {
  if (!value || value.length > MAX_URL_LENGTH) throw new Error("PLUGIN_HTTP_URL_INVALID");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PLUGIN_HTTP_URL_INVALID");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("PLUGIN_HTTP_PROTOCOL_DENIED");
  if (url.username || url.password) throw new Error("PLUGIN_HTTP_CREDENTIALS_DENIED");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".lan")) throw new Error("PLUGIN_HTTP_PRIVATE_ADDRESS_DENIED");
  return url;
}

async function assertPublicUrl(url: URL, lookup: (hostname: string) => Promise<LookupResult[]>) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname);
  if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new Error("PLUGIN_HTTP_PRIVATE_ADDRESS_DENIED");
  }
  return addresses;
}

function sanitizeHeaders(input: Record<string, string> | undefined) {
  const entries = Object.entries(input || {});
  if (entries.length > MAX_HEADERS) throw new Error("PLUGIN_HTTP_HEADERS_TOO_MANY");
  const headers = new Headers();
  const denied = new Set(["connection", "content-length", "host", "proxy-authorization", "transfer-encoding", "upgrade"]);
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim().toLowerCase();
    const value = String(rawValue);
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]{1,80}$/.test(name) || denied.has(name) || name.startsWith("sec-") || value.length > 2_000) {
      throw new Error("PLUGIN_HTTP_HEADER_INVALID");
    }
    headers.set(name, value);
  }
  return headers;
}

function serializeBody(method: PluginHttpMethod, body: unknown, headers: Headers) {
  if (body === undefined || body === null) return undefined;
  if (method === "GET") throw new Error("PLUGIN_HTTP_GET_BODY_DENIED");
  const serialized = typeof body === "string" ? body : JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) throw new Error("PLUGIN_HTTP_REQUEST_TOO_LARGE");
  if (typeof body !== "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  return serialized;
}

function isBinaryContentType(value: string) {
  const contentType = value.split(";", 1)[0].trim().toLowerCase();
  if (!contentType) return false;
  return !contentType.startsWith("text/")
    && contentType !== "application/json"
    && contentType.endsWith("+json") === false
    && contentType !== "application/javascript"
    && contentType !== "application/xml"
    && contentType.endsWith("+xml") === false
    && contentType !== "application/x-www-form-urlencoded";
}

function requestPinned(url: URL, method: PluginHttpMethod, headers: Headers, body: string | undefined, signal: AbortSignal, address: LookupResult, responseMode: PluginHttpRequest["responseMode"]) {
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === "https:" ? requestHttps : requestHttp)(url, {
      method,
      headers: Object.fromEntries(headers.entries()),
      signal,
      family: address.family,
      lookup: ((_hostname: string, options: unknown, callback: unknown) => {
        if (options && typeof options === "object" && "all" in options && options.all === true) {
          (callback as (error: NodeJS.ErrnoException | null, addresses: LookupResult[]) => void)(null, [address]);
          return;
        }
        (callback as (error: NodeJS.ErrnoException | null, resolvedAddress: string, family: number) => void)(null, address.address, address.family);
      }) as never,
    }, (incoming) => {
      const contentType = String(incoming.headers["content-type"] || "");
      if (responseMode === "media" || isBinaryContentType(contentType)) {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(name, String(item));
        }
        incoming.on("error", () => undefined);
        resolve(new Response(null, {
          status: incoming.statusCode || 500,
          statusText: incoming.statusMessage,
          headers: responseHeaders,
        }));
        incoming.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      incoming.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_RESPONSE_BYTES) {
          incoming.destroy(new Error("PLUGIN_HTTP_RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(bytes);
      });
      incoming.on("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(name, String(item));
        }
        resolve(new Response(Buffer.concat(chunks), {
          status: incoming.statusCode || 500,
          statusText: incoming.statusMessage,
          headers: responseHeaders,
        }));
      });
      incoming.on("error", reject);
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

async function readLimitedBody(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("PLUGIN_HTTP_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function responseHeaders(response: Response) {
  const result: Record<string, string> = {};
  let count = 0;
  for (const [name, value] of response.headers) {
    if (count >= MAX_HEADERS || name === "set-cookie" || name === "www-authenticate" || name === "proxy-authenticate") continue;
    result[name] = value.slice(0, 1_000);
    count += 1;
  }
  return result;
}

export async function requestPluginHttp(request: PluginHttpRequest, signal: AbortSignal, dependencies: PluginHttpDependencies = {}): Promise<PluginHttpResponse> {
  const lookup = dependencies.lookup || (async (hostname: string) => lookupDns(hostname, { all: true, verbatim: true }));
  let url = parseUrl(String(request.url || ""));
  let method = String(request.method || "GET").toUpperCase() as PluginHttpMethod;
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("PLUGIN_HTTP_METHOD_INVALID");
  const headers = sanitizeHeaders(request.headers);
  let body = serializeBody(method, request.body, headers);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const addresses = await assertPublicUrl(url, lookup);
    const response = dependencies.fetch
      ? await dependencies.fetch(url, { method, headers, body, redirect: "manual", signal })
      : await requestPinned(url, method, headers, body, signal, addresses[0], request.responseMode);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === MAX_REDIRECTS) throw new Error("PLUGIN_HTTP_REDIRECT_LIMIT");
      const location = response.headers.get("location");
      if (!location) throw new Error("PLUGIN_HTTP_REDIRECT_INVALID");
      const nextUrl = parseUrl(new URL(location, url).toString());
      if (nextUrl.origin !== url.origin) {
        headers.delete("authorization");
        headers.delete("cookie");
      }
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        headers.delete("content-type");
      }
      url = nextUrl;
      continue;
    }

    const contentType = response.headers.get("content-type") || "";
    const skipBody = request.responseMode === "media" || isBinaryContentType(contentType);
    const text = skipBody ? "" : await readLimitedBody(response);
    if (skipBody) await response.body?.cancel();
    let parsedBody: unknown = text;
    if (text && /(?:application\/json|\+json)(?:;|$)/i.test(contentType)) {
      try { parsedBody = JSON.parse(text); } catch { parsedBody = text; }
    }
    return { url: url.toString(), status: response.status, ok: response.ok, headers: responseHeaders(response), body: parsedBody };
  }
  throw new Error("PLUGIN_HTTP_REDIRECT_LIMIT");
}

export const pluginHttpLimits = {
  maxUrlLength: MAX_URL_LENGTH,
  maxRequestBytes: MAX_REQUEST_BYTES,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  maxRedirects: MAX_REDIRECTS,
};
