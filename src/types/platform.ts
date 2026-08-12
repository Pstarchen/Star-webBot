export type UserRole = "admin" | "developer" | "operator";

export type MembershipPlanId = "free" | "pro" | "team";

export type MembershipPlan = {
  id: MembershipPlanId;
  name: string;
  botQuota: number;
  pluginQuota: number;
  eventRetentionDays: number;
};

export type BotStatus = "online" | "degraded" | "offline";

export type BotConnectionMode = "websocket" | "webhook";

export type Bot = {
  id: string;
  name: string;
  appId: string;
  avatar: string;
  status: BotStatus;
  environment: "production" | "sandbox";
  connectionMode: BotConnectionMode;
  messageCount: number;
  successRate: number;
  latency: number;
  eventsToday: number;
  lastSeen: string;
  tags: string[];
  shardCount: number;
  onlineShards: number;
  webhookPath: string;
};

export type EventLog = {
  id: string;
  type: string;
  botName: string;
  scene: "群聊" | "单聊" | "频道" | "系统";
  status: "success" | "warning" | "failed";
  latency: number;
  time: string;
  content: string;
  payload?: unknown;
  traceId?: string | null;
};

export type Plugin = {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon: string;
  installed: boolean;
  enabled: boolean;
  installs: number;
  category: string;
  runtime: "sdk";
  botId: string;
  events: string[];
  permissions: string[];
  pendingEvents: number;
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  botQuota: number;
  botCount: number;
  status: "active" | "invited" | "suspended";
  lastActive: string;
  membershipPlan: MembershipPlanId;
  membershipName: string;
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  botQuota: number;
  membershipPlan: MembershipPlanId;
  membershipName: string;
};

export type MessagePayload = {
  content?: string;
  msg_type?: 0 | 2 | 7;
  msg_id?: string;
  event_id?: string;
  msg_seq?: number;
  markdown?: Record<string, unknown>;
  media?: { file_info: string };
};
