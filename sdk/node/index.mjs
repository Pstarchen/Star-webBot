import { createHash, createHmac, randomBytes } from "node:crypto";

function normalizePlatformUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('platformUrl must use HTTP or HTTPS');
  return url.toString().replace(/\/$/, '');
}

export class StarBotClient {
  constructor({ platformUrl, pluginId, secret, fetch: fetchImplementation = globalThis.fetch }) {
    if (!pluginId || !secret) throw new Error('pluginId and secret are required');
    if (typeof fetchImplementation !== 'function') throw new Error('A fetch implementation is required');
    this.platformUrl = normalizePlatformUrl(platformUrl);
    this.pluginId = pluginId;
    this.secret = secret;
    this.fetch = fetchImplementation;
    this.handlers = new Map();
  }

  signedHeaders(canonicalPayload) {
    const timestamp = Date.now().toString();
    const nonce = randomBytes(18).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(`${timestamp}.${nonce}.${canonicalPayload}`).digest('hex');
    return {
      'X-StarBot-Timestamp': timestamp,
      'X-StarBot-Nonce': nonce,
      'X-StarBot-Signature': `sha256=${signature}`,
    };
  }

  async jsonRequest(path, payload, { signal } = {}) {
    const rawBody = JSON.stringify(payload);
    const response = await this.fetch(`${this.platformUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.signedHeaders(rawBody) },
      body: rawBody,
      signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new StarBotHttpError(result?.message || `StarBot HTTP ${response.status}`, response.status, result);
      throw error;
    }
    return result;
  }

  pullEvents({ limit = 10, waitMs = 25_000, signal } = {}) {
    return this.jsonRequest(`/api/plugin-runtime/${this.pluginId}/events/pull`, { limit, waitMs }, { signal });
  }

  ackEvents(leaseToken, deliveryIds, { signal } = {}) {
    return this.jsonRequest(`/api/plugin-runtime/${this.pluginId}/events/ack`, { leaseToken, deliveryIds }, { signal });
  }

  callOpenApi(method, path, body, { signal } = {}) {
    return this.jsonRequest(`/api/plugin-runtime/${this.pluginId}/openapi`, { method, path, body }, { signal });
  }

  sendC2C(userOpenid, payload, options) {
    return this.callOpenApi('POST', `/v2/users/${encodeURIComponent(userOpenid)}/messages`, payload, options);
  }

  sendGroup(groupOpenid, payload, options) {
    return this.callOpenApi('POST', `/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, payload, options);
  }

  on(eventType, handler) {
    if (!eventType || typeof handler !== 'function') throw new Error('eventType and handler are required');
    const handlers = this.handlers.get(eventType) || new Set();
    handlers.add(handler);
    this.handlers.set(eventType, handlers);
    return this;
  }

  off(eventType, handler) {
    const handlers = this.handlers.get(eventType);
    handlers?.delete(handler);
    if (handlers?.size === 0) this.handlers.delete(eventType);
    return this;
  }

  async dispatch(event) {
    const handlers = [...(this.handlers.get(event.type) || []), ...(this.handlers.get('*') || [])];
    for (const handler of handlers) await handler(event, this);
  }

  start(options) {
    return this.run((event) => this.dispatch(event), options);
  }

  async callMultipart(path, formData, { signal } = {}) {
    const encoded = new Response(formData);
    const contentType = encoded.headers.get('content-type');
    const body = Buffer.from(await encoded.arrayBuffer());
    if (!contentType) throw new Error('Failed to encode multipart body');
    const canonical = ['POST', path, contentType, createHash('sha256').update(body).digest('hex')].join('\n');
    const response = await this.fetch(`${this.platformUrl}/api/plugin-runtime/${this.pluginId}/multipart?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, ...this.signedHeaders(canonical) },
      body,
      signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || `StarBot multipart HTTP ${response.status}`);
    return result;
  }

  async run(handler, { batchSize = 10, waitMs = 25_000, retryDelayMs = 1_000, signal } = {}) {
    if (typeof handler !== 'function') throw new Error('handler must be a function');
    while (!signal?.aborted) {
      try {
        const batch = await this.pullEvents({ limit: batchSize, waitMs, signal });
        for (const event of batch.events) {
          await handler(event, this);
          await this.ackEvents(batch.leaseToken, [event.id], { signal });
        }
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') return;
        if (error instanceof StarBotHttpError && [401, 403].includes(error.status)) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
}

export class StarBotHttpError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'StarBotHttpError';
    this.status = status;
    this.detail = detail;
  }
}
