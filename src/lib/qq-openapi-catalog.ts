export const QQ_OPENAPI_ENDPOINTS = {
  deleteChannel: { method: "DELETE", path: "/channels/{channel_id}", title: "删除子频道" },
  getChannel: { method: "GET", path: "/channels/{channel_id}", title: "获取子频道详情" },
  getGuild: { method: "GET", path: "/guilds/{guild_id}", title: "获取频道详情" },
  updateChannel: { method: "PATCH", path: "/channels/{channel_id}", title: "修改子频道" },
  getGateway: { method: "GET", path: "/gateway", title: "获取通用 WSS 接入点" },
  listGuildChannels: { method: "GET", path: "/guilds/{guild_id}/channels", title: "获取子频道列表" },
  createGuildChannel: { method: "POST", path: "/guilds/{guild_id}/channels", title: "创建子频道" },
  acknowledgeInteraction: { method: "PUT", path: "/interactions/{interaction_id}", title: "互动事件响应" },
  generateUrlLink: { method: "POST", path: "/v2/generate_url_link", title: "生成分享链接" },
  getBotProfile: { method: "GET", path: "/users/@me", title: "获取机器人详情" },
  prepareGroupMediaUpload: { method: "POST", path: "/v2/groups/{group_id}/upload_prepare", title: "群聊富媒体预上传" },
  finishGroupMediaPart: { method: "POST", path: "/v2/groups/{group_id}/upload_part_finish", title: "群聊分片上传完成" },
  listBotGuilds: { method: "GET", path: "/users/@me/guilds", title: "获取机器人加入的频道列表" },
  approveGroupJoinRequest: { method: "POST", path: "/v2/groups/{group_openid}/approval_join_request/{member_openid}", title: "入群申请审批" },
  getBotGroupState: { method: "GET", path: "/v2/groups/{group_openid}/bot_state", title: "获取机器人群内状态" },
  listGroupJoinRequests: { method: "GET", path: "/v2/groups/{group_openid}/join_request_list", title: "入群申请列表拉取" },
  getGroupInfo: { method: "GET", path: "/v2/groups/{group_openid}/info", title: "获取群基本信息" },
  uploadGroupMedia: { method: "POST", path: "/v2/groups/{group_openid}/files", title: "群聊富媒体上传" },
  sendGroupMessage: { method: "POST", path: "/v2/groups/{group_openid}/messages", title: "发送群聊消息" },
  recallGroupMessage: { method: "DELETE", path: "/v2/groups/{group_openid}/messages/{message_id}", title: "撤回群聊消息" },
  getGroupMuteSettings: { method: "GET", path: "/v2/groups/{group_openid}/restrict_chat_setting", title: "查询群禁言状态" },
  setGroupMemberMute: { method: "POST", path: "/v2/groups/{group_openid}/restrict_chat_setting", title: "设置群成员禁言" },
  createGroupJoinApprovalStrategy: { method: "POST", path: "/v2/groups/join_approval_strategy", title: "创建入群自动审批策略" },
  listGroupJoinApprovalStrategies: { method: "GET", path: "/v2/groups/join_approval_strategy", title: "查询入群自动审批策略列表" },
  updateGroupJoinApprovalStrategy: { method: "PATCH", path: "/v2/groups/join_approval_strategy/{strategy_id}", title: "修改入群自动审批策略" },
  deleteGroupJoinApprovalStrategy: { method: "DELETE", path: "/v2/groups/join_approval_strategy/{strategy_id}", title: "删除入群自动审批策略" },
  executeGroupJoinApprovalStrategy: { method: "POST", path: "/v2/groups/join_approval_strategy/{strategy_id}/execute", title: "执行入群自动审批策略" },
  finishC2CMediaPart: { method: "POST", path: "/v2/users/{user_id}/upload_part_finish", title: "单聊分片上传完成" },
  updateGroupJoinApprovalWhitelist: { method: "POST", path: "/v2/groups/join_approval_strategy/{strategy_id}/whitelist_users", title: "修改入群自动审批策略的白名单号码" },
  prepareC2CMediaUpload: { method: "POST", path: "/v2/users/{user_id}/upload_prepare", title: "单聊富媒体预上传" },
  uploadC2CMedia: { method: "POST", path: "/v2/users/{user_openid}/files", title: "单聊富媒体上传" },
  sendC2CMessage: { method: "POST", path: "/v2/users/{user_openid}/messages", title: "发送单聊消息" },
  recallC2CMessage: { method: "DELETE", path: "/v2/users/{user_openid}/messages/{message_id}", title: "撤回单聊消息" },
  sendC2CStreamMessage: { method: "POST", path: "/v2/users/{user_openid}/stream_messages", title: "流式发送单聊消息" },
} as const;

export type QQOpenApiEndpointId = keyof typeof QQ_OPENAPI_ENDPOINTS;
export type QQOpenApiMethod = typeof QQ_OPENAPI_ENDPOINTS[QQOpenApiEndpointId]["method"];
export type QQOpenApiPathParams = Record<string, string | number | bigint>;
export type QQOpenApiQueryValue = string | number | bigint | boolean | null | undefined;
export type QQOpenApiQuery = Record<string, QQOpenApiQueryValue | readonly QQOpenApiQueryValue[]>;

export function resolveQQOpenApiEndpoint(endpointId: QQOpenApiEndpointId, pathParams: QQOpenApiPathParams = {}, query: QQOpenApiQuery = {}) {
  const endpoint = QQ_OPENAPI_ENDPOINTS[endpointId];
  if (!endpoint) throw new Error("QQ_API_ENDPOINT_UNKNOWN");
  const required = new Set<string>();
  const pathname = endpoint.path.replace(/\{([a-z_]+)\}/g, (_match, name: string) => {
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
