import { createHash, createHmac, randomBytes } from "node:crypto";

export const QQ_OPENAPI_ENDPOINTS = Object.freeze({
  deleteChannel: { method: 'DELETE', path: '/channels/{channel_id}', title: '删除子频道' }, getChannel: { method: 'GET', path: '/channels/{channel_id}', title: '获取子频道详情' }, getGuild: { method: 'GET', path: '/guilds/{guild_id}', title: '获取频道详情' }, updateChannel: { method: 'PATCH', path: '/channels/{channel_id}', title: '修改子频道' }, getGateway: { method: 'GET', path: '/gateway', title: '获取通用 WSS 接入点' }, listGuildChannels: { method: 'GET', path: '/guilds/{guild_id}/channels', title: '获取子频道列表' }, createGuildChannel: { method: 'POST', path: '/guilds/{guild_id}/channels', title: '创建子频道' }, acknowledgeInteraction: { method: 'PUT', path: '/interactions/{interaction_id}', title: '互动事件响应' }, generateUrlLink: { method: 'POST', path: '/v2/generate_url_link', title: '生成分享链接' }, getGlobalMenu: { method: 'GET', path: '/v2/menu', title: '查询全局自定义菜单' }, updateGlobalMenu: { method: 'PUT', path: '/v2/menu', title: '修改全局自定义菜单' }, createCommandPanel: { method: 'POST', path: '/v2/panels', title: '创建指令面板' }, listCommandPanels: { method: 'GET', path: '/v2/panels', title: '查询指令面板列表' }, deleteCommandPanel: { method: 'DELETE', path: '/v2/panels/{panel_id}', title: '删除指令面板' }, getCommandPanel: { method: 'GET', path: '/v2/panels/{panel_id}', title: '查询指令面板详情' }, updateCommandPanelTarget: { method: 'PUT', path: '/v2/panels/{panel_id}/target', title: '修改指令面板关联对象' }, updateCommandPanel: { method: 'PUT', path: '/v2/panels/{panel_id}', title: '修改指令面板' }, getBotProfile: { method: 'GET', path: '/users/@me', title: '获取机器人详情' }, prepareGroupMediaUpload: { method: 'POST', path: '/v2/groups/{group_id}/upload_prepare', title: '群聊富媒体预上传' }, finishGroupMediaPart: { method: 'POST', path: '/v2/groups/{group_id}/upload_part_finish', title: '群聊分片上传完成' }, listBotGuilds: { method: 'GET', path: '/users/@me/guilds', title: '获取机器人加入的频道列表' }, approveGroupJoinRequest: { method: 'POST', path: '/v2/groups/{group_openid}/approval_join_request/{member_openid}', title: '入群申请审批' }, getBotGroupState: { method: 'GET', path: '/v2/groups/{group_openid}/bot_state', title: '获取机器人群内状态' }, listGroupJoinRequests: { method: 'GET', path: '/v2/groups/{group_openid}/join_request_list', title: '入群申请列表拉取' }, getGroupInfo: { method: 'GET', path: '/v2/groups/{group_openid}/info', title: '获取群基本信息' }, uploadGroupMedia: { method: 'POST', path: '/v2/groups/{group_openid}/files', title: '群聊富媒体上传' }, sendGroupMessage: { method: 'POST', path: '/v2/groups/{group_openid}/messages', title: '发送群聊消息' }, recallGroupMessage: { method: 'DELETE', path: '/v2/groups/{group_openid}/messages/{message_id}', title: '撤回群聊消息' }, getGroupMuteSettings: { method: 'GET', path: '/v2/groups/{group_openid}/restrict_chat_setting', title: '查询群禁言状态' }, setGroupMemberMute: { method: 'POST', path: '/v2/groups/{group_openid}/restrict_chat_setting', title: '设置群成员禁言' }, createGroupJoinApprovalStrategy: { method: 'POST', path: '/v2/groups/join_approval_strategy', title: '创建入群自动审批策略' }, listGroupJoinApprovalStrategies: { method: 'GET', path: '/v2/groups/join_approval_strategy', title: '查询入群自动审批策略列表' }, updateGroupJoinApprovalStrategy: { method: 'PATCH', path: '/v2/groups/join_approval_strategy/{strategy_id}', title: '修改入群自动审批策略' }, deleteGroupJoinApprovalStrategy: { method: 'DELETE', path: '/v2/groups/join_approval_strategy/{strategy_id}', title: '删除入群自动审批策略' }, executeGroupJoinApprovalStrategy: { method: 'POST', path: '/v2/groups/join_approval_strategy/{strategy_id}/execute', title: '执行入群自动审批策略' }, finishC2CMediaPart: { method: 'POST', path: '/v2/users/{user_id}/upload_part_finish', title: '单聊分片上传完成' }, updateGroupJoinApprovalWhitelist: { method: 'POST', path: '/v2/groups/join_approval_strategy/{strategy_id}/whitelist_users', title: '修改入群自动审批策略的白名单号码' }, prepareC2CMediaUpload: { method: 'POST', path: '/v2/users/{user_id}/upload_prepare', title: '单聊富媒体预上传' }, uploadC2CMedia: { method: 'POST', path: '/v2/users/{user_openid}/files', title: '单聊富媒体上传' }, sendC2CMessage: { method: 'POST', path: '/v2/users/{user_openid}/messages', title: '发送单聊消息' }, recallC2CMessage: { method: 'DELETE', path: '/v2/users/{user_openid}/messages/{message_id}', title: '撤回单聊消息' }, sendC2CStreamMessage: { method: 'POST', path: '/v2/users/{user_openid}/stream_messages', title: '流式发送单聊消息' },
});

export function resolveQQOpenApiEndpoint(endpointId, pathParams = {}, query = {}) {
  const endpoint = QQ_OPENAPI_ENDPOINTS[endpointId];
  if (!endpoint) throw new Error('QQ_API_ENDPOINT_UNKNOWN');
  const required = new Set();
  const pathname = endpoint.path.replace(/\{([a-z_]+)\}/g, (_match, name) => {
    required.add(name);
    if (!(name in pathParams) || String(pathParams[name]).length === 0) throw new Error(`QQ_API_PATH_PARAM_REQUIRED:${name}`);
    return encodeURIComponent(String(pathParams[name]));
  });
  const unknownParam = Object.keys(pathParams).find((name) => !required.has(name));
  if (unknownParam) throw new Error(`QQ_API_PATH_PARAM_UNKNOWN:${unknownParam}`);
  const search = new URLSearchParams();
  for (const [name, rawValue] of Object.entries(query)) {
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      if (value !== undefined && value !== null) search.append(name, String(value));
    }
  }
  const queryString = search.toString();
  return { ...endpoint, path: queryString ? `${pathname}?${queryString}` : pathname };
}

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

  callEndpoint(endpointId, pathParams = {}, body, { query = {}, signal } = {}) {
    const endpoint = resolveQQOpenApiEndpoint(endpointId, pathParams, query);
    return this.callOpenApi(endpoint.method, endpoint.path, body, { signal });
  }

  sendC2C(userOpenid, payload, options) {
    return this.callOpenApi('POST', `/v2/users/${encodeURIComponent(userOpenid)}/messages`, payload, options);
  }

  sendGroup(groupOpenid, payload, options) {
    return this.callOpenApi('POST', `/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, payload, options);
  }

  getBotProfile(options) {
    return this.callOpenApi('GET', '/users/@me', undefined, options);
  }

  recallC2C(userOpenid, messageId, options) {
    return this.callOpenApi('DELETE', `/v2/users/${encodeURIComponent(userOpenid)}/messages/${encodeURIComponent(messageId)}`, undefined, options);
  }

  recallGroup(groupOpenid, messageId, options) {
    return this.callOpenApi('DELETE', `/v2/groups/${encodeURIComponent(groupOpenid)}/messages/${encodeURIComponent(messageId)}`, undefined, options);
  }

  getGroupMuteSettings(groupOpenid, options) {
    return this.callOpenApi('GET', `/v2/groups/${encodeURIComponent(groupOpenid)}/restrict_chat_setting`, undefined, options);
  }

  muteGroupMember(groupOpenid, memberOpenid, muteExpireAt, { operation = 'add', signal } = {}) {
    if (!['add', 'update'].includes(operation)) throw new TypeError('operation must be add or update');
    return this.callOpenApi('POST', `/v2/groups/${encodeURIComponent(groupOpenid)}/restrict_chat_setting`, {
      members: [{ op: operation, member_openid: memberOpenid, mute_expire_at: muteExpireAt }],
    }, { signal });
  }

  unmuteGroupMember(groupOpenid, memberOpenid, options) {
    return this.callOpenApi('POST', `/v2/groups/${encodeURIComponent(groupOpenid)}/restrict_chat_setting`, {
      members: [{ op: 'del', member_openid: memberOpenid, mute_expire_at: '' }],
    }, options);
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
