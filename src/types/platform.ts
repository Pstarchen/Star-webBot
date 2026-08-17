export type UserRole = "admin" | "developer" | "operator";

export type MembershipPlanId = "free" | "pro" | "team";

export type MembershipPlan = {
  id: MembershipPlanId;
  name: string;
  botQuota: number;
  pluginQuota: number;
  eventRetentionDays: number;
  description: string;
  monthlyPriceCents: number;
  quarterlyPriceCents: number;
  yearlyPriceCents: number;
  features: string[];
};

export type BillingCycle = "monthly" | "quarterly" | "yearly";
export type PaymentProvider = "sandbox" | "manual" | "epay";
export type PaymentChannel = "alipay" | "wxpay" | "qqpay" | "manual" | "sandbox";

export type MembershipOrder = {
  id: string;
  orderNo: string;
  planId: MembershipPlanId;
  planName: string;
  billingCycle: BillingCycle;
  paymentChannel: PaymentChannel;
  amountCents: number;
  provider: PaymentProvider;
  status: "pending" | "paid" | "cancelled" | "expired" | "failed";
  paymentUrl: string | null;
  paymentNote: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type SitePublicSettings = {
  siteName: string;
  siteTagline: string;
  siteDescription: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  icpCode: string;
  icpUrl: string;
  policeCode: string;
  policeUrl: string;
  copyrightText: string;
};

export type AdminSystemSettings = {
  site: SitePublicSettings;
  qq: { enabled: boolean; appId: string; appSecretConfigured: boolean; redirectUri: string };
  email: {
    registrationVerificationEnabled: boolean;
    loginEnabled: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpStarttls: boolean;
    smtpFrom: string;
    smtpUser: string;
    smtpPassConfigured: boolean;
  };
  payment: {
    enabled: boolean;
    provider: PaymentProvider;
    epayGatewayUrl: string;
    epayPid: string;
    epayKeyConfigured: boolean;
    manualInstructions: string;
  };
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

export type BotMediaTarget = {
  targetType: "c2c" | "group";
  targetOpenid: string;
  lastSeenAt: string;
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

export type HostedPluginJsonValue = string | number | boolean | null | HostedPluginJsonValue[] | { [key: string]: HostedPluginJsonValue };

export type HostedPluginApiDefinition = {
  id: string;
  name: string;
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: HostedPluginJsonValue;
};

export type HostedPluginReplyMedia = {
  type: "image" | "video" | "audio";
  url: string;
  caption?: string;
};

export type HostedPluginReplyRule = {
  id: string;
  name: string;
  prefix: string;
  match: "exact" | "fuzzy";
  threshold?: number;
  apis: string[];
  reply: {
    text?: string;
    media: HostedPluginReplyMedia[];
  };
};

export type HostedPluginConfigValue = string | number | boolean | HostedPluginApiDefinition[] | HostedPluginReplyRule[];

export type HostedPluginConfigField = {
  key: string;
  label: string;
  description?: string;
  type: "text" | "textarea" | "number" | "boolean" | "select" | "api-list" | "reply-list";
  required: boolean;
  default?: HostedPluginConfigValue;
  placeholder?: string;
  min?: number;
  max?: number;
  options?: Array<{ label: string; value: string | number | boolean }>;
};

export type HostedPluginCommand = { name: string; description: string };

export type PluginMarketplaceItem = {
  id: string;
  versionId: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  version: string;
  featured: boolean;
  priceCents: number;
  installs: number;
  enabledBots: number;
  events: string[];
  permissions: string[];
  commands: HostedPluginCommand[];
  configSchema: HostedPluginConfigField[];
  owned: boolean;
  installedBotIds: string[];
};

export type HostedPluginInstallation = {
  id: string;
  projectId: string;
  versionId: string;
  botId: string;
  botName: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  version: string;
  projectStatus: "private" | "pending" | "published" | "rejected" | "suspended";
  enabled: boolean;
  priority: number;
  failureCount: number;
  lastError: string | null;
  lastRunAt: string | null;
  config: Record<string, HostedPluginConfigValue>;
  configSchema: HostedPluginConfigField[];
  configPage: { height: number } | null;
  events: string[];
  permissions: string[];
  commands: HostedPluginCommand[];
  lastRun: null | {
    status: "success" | "skipped" | "failed";
    durationMs: number;
    actionCount: number;
    error: string | null;
    createdAt: string;
  };
};

export type PluginDeveloperProject = {
  id: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  status: "private" | "pending" | "published" | "rejected" | "suspended";
  reviewNote: string | null;
  pendingVersionId: string | null;
  installs: number;
  enabledBots: number;
  versions: Array<{
    id: string;
    version: string;
    packageSha256: string;
    packageSize: number;
    createdAt: string;
  }>;
  updatedAt: string;
};

export type PluginMarketReview = {
  id: string;
  projectId: string;
  projectName: string;
  version: string;
  authorName: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  requestedAt: string;
};

export type PluginCenterData = {
  marketplace: PluginMarketplaceItem[];
  installations: HostedPluginInstallation[];
  projects: PluginDeveloperProject[];
  reviews: PluginMarketReview[];
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
  msg_type?: 0 | 2 | 3 | 7;
  msg_id?: string;
  event_id?: string;
  msg_seq?: number;
  markdown?: Record<string, unknown>;
  ark?: Record<string, unknown>;
  keyboard?: Record<string, unknown>;
  media?: { file_info: string };
};
