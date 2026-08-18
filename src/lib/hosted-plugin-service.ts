import "server-only";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getBotClientInternal, getBotRow } from "@/lib/bot-service";
import { getDatabase, writeAuditLog } from "@/lib/database";
import {
  defaultPluginConfig,
  hostedPluginManifestSchema,
  parseHostedPluginPackage,
  pluginApiDefinitionSchema,
  validatePluginConfig,
} from "@/lib/hosted-plugin-package";
import { executeHostedPlugin, validateHostedPluginCode, type HostedPluginAction } from "@/lib/hosted-plugin-runtime";
import { requestPluginHttp } from "@/lib/plugin-http";
import { uploadQQMediaFromUrl } from "@/lib/qq-media";
import { validateQQApiPath } from "@/lib/qq-api";
import type {
  HostedPluginInstallation,
  HostedPluginConfigValue,
  PluginCenterData,
  PluginDeveloperProject,
  PluginMarketplaceItem,
  PluginMarketReview,
  SessionUser,
} from "@/types/platform";

const AUTO_DISABLE_FAILURES = 5;
const MAX_KV_ENTRIES = 100;
const MAX_KV_VALUE_BYTES = 16 * 1024;
const MAX_KV_TOTAL_BYTES = 128 * 1024;
const MAX_PLUGIN_ASSET_BYTES = 20 * 1024 * 1024;
const pluginAssetTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "text/plain": ".txt",
  "application/octet-stream": ".bin",
} as const;

type ProjectRow = {
  id: string;
  owner_user_id: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  category: string;
  tags_json: string;
  status: "private" | "pending" | "published" | "rejected" | "suspended";
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

type VersionRow = {
  id: string;
  project_id: string;
  version: string;
  manifest_json: string;
  entry_code: string;
  config_page_html: string | null;
  readme: string | null;
  package_sha256: string;
  package_size: number;
  created_at: string;
};

type InstallationExecutionRow = {
  id: string;
  user_id: string;
  bot_id: string;
  project_id: string;
  priority: number;
  manifest_json: string;
  entry_code: string;
};

export type MarketplacePluginUpdate = {
  name?: string;
  description?: string;
  author?: string;
  category?: string;
  tags?: string[];
  featured?: boolean;
  priceCents?: number;
};

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; }
  catch { return fallback; }
}

function parseManifest(value: string) {
  return hostedPluginManifestSchema.parse(JSON.parse(value));
}

function pluginQuota(userId: string) {
  return getDatabase().prepare(`
    SELECT membership_plans.plugin_quota
    FROM user_memberships
    JOIN membership_plans ON membership_plans.id = user_memberships.plan_id
    WHERE user_memberships.user_id = ? AND user_memberships.status = 'active'
  `).get(userId) as { plugin_quota: number } | undefined;
}

function assertInstallationQuota(userId: string) {
  const quota = pluginQuota(userId);
  const usage = getDatabase().prepare(`
    SELECT
      (SELECT COUNT(*) FROM plugin_installations WHERE user_id = ?) +
      (SELECT COUNT(*) FROM plugins WHERE user_id = ?) AS count
  `).get(userId, userId) as { count: number };
  if (!quota || usage.count >= quota.plugin_quota) throw new Error("PLUGIN_QUOTA_EXCEEDED");
}

function accessibleProject(user: SessionUser, projectId: string) {
  const project = getDatabase().prepare("SELECT * FROM plugin_projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
  if (!project || (user.role !== "admin" && project.owner_user_id !== user.id)) throw new Error("PLUGIN_PROJECT_NOT_FOUND");
  return project;
}

function accessibleInstallation(user: SessionUser, installationId: string) {
  const row = getDatabase().prepare("SELECT * FROM plugin_installations WHERE id = ?").get(installationId) as { id: string; user_id: string; bot_id: string; project_id: string; version_id: string; enabled: number } | undefined;
  if (!row || (user.role !== "admin" && row.user_id !== user.id)) throw new Error("PLUGIN_INSTALLATION_NOT_FOUND");
  return row;
}

function readInstallationConfig(installationId: string) {
  const rows = getDatabase().prepare("SELECT `key`, value_json FROM plugin_config_values WHERE installation_id = ?").all(installationId) as Array<{ key: string; value_json: string }>;
  const config: Record<string, HostedPluginConfigValue> = {};
  for (const row of rows) {
    const value = parseJson<unknown>(row.value_json, null);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || Array.isArray(value)) {
      config[row.key] = value as HostedPluginConfigValue;
    }
  }
  return config;
}

function configForManifest(manifest: ReturnType<typeof parseManifest>, current: Record<string, HostedPluginConfigValue>) {
  return Object.fromEntries(manifest.configSchema
    .filter((field) => Object.prototype.hasOwnProperty.call(current, field.key))
    .map((field) => [field.key, current[field.key]]));
}

function readInstallationKv(installationId: string) {
  const rows = getDatabase().prepare("SELECT `key`, value_json FROM plugin_kv WHERE installation_id = ?").all(installationId) as Array<{ key: string; value_json: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, parseJson(row.value_json, null)]));
}

function marketplaceItems(user: SessionUser): PluginMarketplaceItem[] {
  const rows = getDatabase().prepare(`
    SELECT projects.*, versions.id AS version_id, versions.version, versions.manifest_json,
      listings.featured, listings.price_cents, listings.display_name, listings.display_description,
      listings.display_author, listings.display_category, listings.display_tags_json,
      (SELECT COUNT(*) FROM plugin_installations WHERE project_id = projects.id) AS installs,
      (SELECT COUNT(*) FROM plugin_installations WHERE project_id = projects.id AND enabled = 1) AS enabled_bots
    FROM plugin_market_listings listings
    JOIN plugin_projects projects ON projects.id = listings.project_id
    JOIN plugin_versions versions ON versions.id = listings.version_id
    WHERE projects.status = 'published'
    ORDER BY listings.featured DESC, listings.published_at DESC
  `).all() as Array<ProjectRow & {
    version_id: string; version: string; manifest_json: string; featured: number; price_cents: number;
    display_name: string | null; display_description: string | null; display_author: string | null;
    display_category: string | null; display_tags_json: string | null; installs: number; enabled_bots: number;
  }>;
  const installed = getDatabase().prepare("SELECT project_id, bot_id FROM plugin_installations WHERE user_id = ?").all(user.id) as Array<{ project_id: string; bot_id: string }>;
  const installedByProject = new Map<string, string[]>();
  for (const row of installed) installedByProject.set(row.project_id, [...(installedByProject.get(row.project_id) || []), row.bot_id]);
  return rows.map((row) => {
    const manifest = parseManifest(row.manifest_json);
    return {
      id: row.id,
      versionId: row.version_id,
      slug: manifest.id,
      name: row.display_name || manifest.name,
      description: row.display_description || manifest.description,
      author: row.display_author || manifest.author,
      category: row.display_category || manifest.category,
      tags: row.display_tags_json ? parseJson(row.display_tags_json, manifest.tags) : manifest.tags,
      version: row.version,
      featured: Boolean(row.featured),
      priceCents: row.price_cents,
      installs: row.installs,
      enabledBots: row.enabled_bots,
      events: manifest.events,
      permissions: manifest.permissions,
      commands: manifest.commands,
      configSchema: manifest.configSchema,
      owned: row.owner_user_id === user.id,
      installedBotIds: installedByProject.get(row.id) || [],
    };
  });
}

function installations(user: SessionUser): HostedPluginInstallation[] {
  const rows = getDatabase().prepare(`
    SELECT installations.*, bots.name AS bot_name, projects.slug, projects.name, projects.description, projects.status AS project_status,
      projects.owner_user_id, projects.author, projects.category, projects.tags_json, versions.version, versions.manifest_json,
      (SELECT latest_versions.id FROM plugin_versions latest_versions WHERE latest_versions.project_id = projects.id AND latest_versions.status = 'active' ORDER BY latest_versions.created_at DESC LIMIT 1) AS owner_latest_version_id,
      (SELECT latest_versions.version FROM plugin_versions latest_versions WHERE latest_versions.project_id = projects.id AND latest_versions.status = 'active' ORDER BY latest_versions.created_at DESC LIMIT 1) AS owner_latest_version,
      listings.version_id AS listing_version_id, listing_versions.version AS listing_version,
      runs.status AS run_status, runs.duration_ms AS run_duration_ms, runs.action_count AS run_action_count,
      runs.error AS run_error, runs.created_at AS run_created_at
    FROM plugin_installations installations
    JOIN bots ON bots.id = installations.bot_id
    JOIN plugin_projects projects ON projects.id = installations.project_id
    JOIN plugin_versions versions ON versions.id = installations.version_id
    LEFT JOIN plugin_market_listings listings ON listings.project_id = projects.id
    LEFT JOIN plugin_versions listing_versions ON listing_versions.id = listings.version_id
    LEFT JOIN plugin_runs runs ON runs.id = (
      SELECT id FROM plugin_runs WHERE installation_id = installations.id ORDER BY created_at DESC LIMIT 1
    )
    WHERE installations.user_id = ?
    ORDER BY installations.updated_at DESC
  `).all(user.id) as Array<{
    id: string; project_id: string; version_id: string; bot_id: string; bot_name: string; slug: string; name: string;
    description: string; owner_user_id: string; author: string; category: string; tags_json: string; version: string; manifest_json: string; project_status: ProjectRow["status"];
    owner_latest_version_id: string | null; owner_latest_version: string | null; listing_version_id: string | null; listing_version: string | null;
    enabled: number; priority: number; failure_count: number; last_error: string | null; last_run_at: string | null;
    run_status: "success" | "skipped" | "failed" | null; run_duration_ms: number | null; run_action_count: number | null;
    run_error: string | null; run_created_at: string | null;
  }>;
  return rows.map((row) => {
    const manifest = parseManifest(row.manifest_json);
    const latestVersionId = row.owner_user_id === user.id ? row.owner_latest_version_id : row.listing_version_id;
    const latestVersion = row.owner_user_id === user.id ? row.owner_latest_version : row.listing_version;
    return {
      id: row.id,
      projectId: row.project_id,
      versionId: row.version_id,
      botId: row.bot_id,
      botName: row.bot_name,
      slug: manifest.id,
      name: manifest.name,
      description: manifest.description,
      author: manifest.author,
      category: manifest.category,
      tags: manifest.tags,
      version: row.version,
      latestVersionId,
      latestVersion,
      projectStatus: row.project_status,
      enabled: Boolean(row.enabled),
      priority: row.priority,
      failureCount: row.failure_count,
      lastError: row.last_error,
      lastRunAt: row.last_run_at,
      config: readInstallationConfig(row.id),
      configSchema: manifest.configSchema,
      configPage: manifest.configPage ? { height: manifest.configPage.height } : null,
      events: manifest.events,
      permissions: manifest.permissions,
      commands: manifest.commands,
      lastRun: row.run_status && row.run_created_at ? {
        status: row.run_status,
        durationMs: row.run_duration_ms || 0,
        actionCount: row.run_action_count || 0,
        error: row.run_error,
        createdAt: row.run_created_at,
      } : null,
    };
  });
}

function developerProjects(user: SessionUser): PluginDeveloperProject[] {
  const rows = getDatabase().prepare(`
    SELECT projects.*,
      (SELECT COUNT(*) FROM plugin_installations WHERE project_id = projects.id) AS installs,
      (SELECT COUNT(*) FROM plugin_installations WHERE project_id = projects.id AND enabled = 1) AS enabled_bots,
      (SELECT version_id FROM plugin_market_reviews WHERE project_id = projects.id AND status = 'pending' LIMIT 1) AS pending_version_id
    FROM plugin_projects projects
    WHERE projects.owner_user_id = ?
    ORDER BY projects.updated_at DESC
  `).all(user.id) as Array<ProjectRow & { installs: number; enabled_bots: number; pending_version_id: string | null }>;
  const versionsQuery = getDatabase().prepare("SELECT id, version, package_sha256, package_size, created_at FROM plugin_versions WHERE project_id = ? ORDER BY created_at DESC");
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    author: row.author,
    category: row.category,
    tags: parseJson(row.tags_json, []),
    status: row.status,
    reviewNote: row.review_note,
    pendingVersionId: row.pending_version_id,
    installs: row.installs,
    enabledBots: row.enabled_bots,
    versions: (versionsQuery.all(row.id) as Array<{ id: string; version: string; package_sha256: string; package_size: number; created_at: string }>).map((version) => ({
      id: version.id,
      version: version.version,
      packageSha256: version.package_sha256,
      packageSize: version.package_size,
      createdAt: version.created_at,
    })),
    updatedAt: row.updated_at,
  }));
}

function pendingReviews(user: SessionUser): PluginMarketReview[] {
  if (user.role !== "admin") return [];
  const rows = getDatabase().prepare(`
    SELECT reviews.*, projects.name AS project_name, versions.version, users.name AS author_name
    FROM plugin_market_reviews reviews
    JOIN plugin_projects projects ON projects.id = reviews.project_id
    JOIN plugin_versions versions ON versions.id = reviews.version_id
    JOIN users ON users.id = reviews.requested_by
    WHERE reviews.status = 'pending'
    ORDER BY reviews.requested_at ASC
  `).all() as Array<{ id: string; project_id: string; project_name: string; version: string; author_name: string; status: "pending"; review_note: string | null; requested_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    version: row.version,
    authorName: row.author_name,
    status: row.status,
    reviewNote: row.review_note,
    requestedAt: row.requested_at,
  }));
}

export function listPluginCenter(user: SessionUser): PluginCenterData {
  return {
    marketplace: marketplaceItems(user),
    installations: installations(user),
    projects: developerProjects(user),
    reviews: pendingReviews(user),
  };
}

export async function importPluginPackage(user: SessionUser, packageBytes: Uint8Array) {
  const parsed = parseHostedPluginPackage(packageBytes);
  await validateHostedPluginCode(parsed.entryCode);
  const database = getDatabase();
  const now = new Date().toISOString();
  const existing = database.prepare("SELECT * FROM plugin_projects WHERE owner_user_id = ? AND slug = ?").get(user.id, parsed.manifest.id) as ProjectRow | undefined;
  if (existing?.status === "suspended") throw new Error("PLUGIN_PROJECT_SUSPENDED");
  const projectId = existing?.id || randomUUID();
  const versionId = randomUUID();

  database.transaction(() => {
    if (existing) {
      database.prepare(`
        UPDATE plugin_projects SET name = ?, description = ?, author = ?, category = ?, tags_json = ?,
          status = CASE WHEN status IN ('private', 'rejected') THEN 'private' ELSE status END,
          review_note = CASE WHEN status IN ('private', 'rejected') THEN NULL ELSE review_note END, updated_at = ?
        WHERE id = ?
      `).run(parsed.manifest.name, parsed.manifest.description, parsed.manifest.author, parsed.manifest.category, JSON.stringify(parsed.manifest.tags), now, projectId);
    } else {
      database.prepare(`
        INSERT INTO plugin_projects
          (id, owner_user_id, slug, name, description, author, category, tags_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?)
      `).run(projectId, user.id, parsed.manifest.id, parsed.manifest.name, parsed.manifest.description, parsed.manifest.author, parsed.manifest.category, JSON.stringify(parsed.manifest.tags), now, now);
    }
    database.prepare(`
      INSERT INTO plugin_versions
        (id, project_id, version, manifest_json, entry_code, config_page_html, readme, package_sha256, package_size, validation_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(versionId, projectId, parsed.manifest.version, JSON.stringify(parsed.manifest), parsed.entryCode, parsed.configPageHtml, parsed.readme, parsed.packageSha256, parsed.packageSize, JSON.stringify(parsed.validation), now);
  })();
  writeAuditLog(user.id, "hosted_plugin.import", "plugin_project", projectId, { versionId, version: parsed.manifest.version, sha256: parsed.packageSha256 });
  return { projectId, versionId, manifest: parsed.manifest, validation: parsed.validation };
}

export function installPlugin(user: SessionUser, input: { projectId: string; botId: string; versionId?: string; priority?: number }) {
  getBotRow(user, input.botId);
  assertInstallationQuota(user.id);
  const database = getDatabase();
  const project = database.prepare("SELECT * FROM plugin_projects WHERE id = ?").get(input.projectId) as ProjectRow | undefined;
  if (!project || project.status === "suspended") throw new Error("PLUGIN_PROJECT_NOT_FOUND");
  const listing = database.prepare("SELECT version_id FROM plugin_market_listings WHERE project_id = ?").get(project.id) as { version_id: string } | undefined;
  if (project.owner_user_id !== user.id && !listing) throw new Error("PLUGIN_PROJECT_NOT_AVAILABLE");
  const versionId = input.versionId || (project.owner_user_id === user.id
    ? (database.prepare("SELECT id FROM plugin_versions WHERE project_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(project.id) as { id: string } | undefined)?.id
    : listing?.version_id);
  if (!versionId) throw new Error("PLUGIN_VERSION_NOT_FOUND");
  const version = database.prepare("SELECT * FROM plugin_versions WHERE id = ? AND project_id = ? AND status = 'active'").get(versionId, project.id) as VersionRow | undefined;
  if (!version || (project.owner_user_id !== user.id && version.id !== listing?.version_id)) throw new Error("PLUGIN_VERSION_NOT_FOUND");
  const manifest = parseManifest(version.manifest_json);
  const defaults = defaultPluginConfig(manifest);
  const installationId = randomUUID();
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare(`
      INSERT INTO plugin_installations
        (id, user_id, bot_id, project_id, version_id, enabled, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(installationId, user.id, input.botId, project.id, version.id, input.priority ?? 50, now, now);
    const insertConfig = database.prepare("INSERT INTO plugin_config_values (installation_id, `key`, value_json, updated_at) VALUES (?, ?, ?, ?)");
    for (const [key, value] of Object.entries(defaults)) insertConfig.run(installationId, key, JSON.stringify(value), now);
  })();
  writeAuditLog(user.id, "hosted_plugin.install", "plugin_installation", installationId, { projectId: project.id, versionId: version.id, botId: input.botId });
  return { installationId };
}

export function updatePluginInstallation(user: SessionUser, installationId: string, input: { enabled?: boolean; priority?: number; versionId?: string; config?: unknown }) {
  const installation = accessibleInstallation(user, installationId);
  const database = getDatabase();
  const versionId = input.versionId || installation.version_id;
  const version = database.prepare("SELECT * FROM plugin_versions WHERE id = ? AND project_id = ? AND status = 'active'").get(versionId, installation.project_id) as VersionRow | undefined;
  if (!version) throw new Error("PLUGIN_VERSION_NOT_FOUND");
  const project = database.prepare("SELECT owner_user_id, status FROM plugin_projects WHERE id = ?").get(installation.project_id) as { owner_user_id: string; status: ProjectRow["status"] } | undefined;
  if (!project) throw new Error("PLUGIN_PROJECT_NOT_FOUND");
  if (input.enabled === true && project.status === "suspended") throw new Error("PLUGIN_PROJECT_SUSPENDED");
  if (user.role !== "admin" && project.owner_user_id !== user.id) {
    const listing = database.prepare("SELECT version_id FROM plugin_market_listings WHERE project_id = ?").get(installation.project_id) as { version_id: string } | undefined;
    if (listing?.version_id !== version.id) throw new Error("PLUGIN_VERSION_NOT_AVAILABLE");
  }
  const manifest = parseManifest(version.manifest_json);
  const currentConfig = readInstallationConfig(installationId);
  const config = input.config === undefined
    ? input.versionId === undefined
      ? null
      : validatePluginConfig(manifest, configForManifest(manifest, currentConfig))
    : validatePluginConfig(manifest, input.config);
  if (input.enabled === true && !config) validatePluginConfig(manifest, configForManifest(manifest, currentConfig));
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare(`
      UPDATE plugin_installations SET version_id = ?, enabled = COALESCE(?, enabled), priority = COALESCE(?, priority),
        failure_count = CASE WHEN ? = 1 THEN 0 ELSE failure_count END,
        last_error = CASE WHEN ? = 1 THEN NULL ELSE last_error END, updated_at = ? WHERE id = ?
    `).run(version.id, input.enabled === undefined ? null : input.enabled ? 1 : 0, input.priority ?? null, input.enabled ? 1 : 0, input.enabled ? 1 : 0, now, installationId);
    if (config) {
      database.prepare("DELETE FROM plugin_config_values WHERE installation_id = ?").run(installationId);
      const insert = database.prepare("INSERT INTO plugin_config_values (installation_id, `key`, value_json, updated_at) VALUES (?, ?, ?, ?)");
      for (const [key, value] of Object.entries(config)) insert.run(installationId, key, JSON.stringify(value), now);
    }
  })();
  writeAuditLog(user.id, "hosted_plugin.installation.update", "plugin_installation", installationId, { enabled: input.enabled, priority: input.priority, versionId: version.id, configUpdated: Boolean(config) });
}

function configPageVersion(user: SessionUser, installationId: string) {
  const installation = accessibleInstallation(user, installationId);
  const version = getDatabase().prepare("SELECT manifest_json, config_page_html FROM plugin_versions WHERE id = ? AND status = 'active'").get(installation.version_id) as Pick<VersionRow, "manifest_json" | "config_page_html"> | undefined;
  if (!version) throw new Error("PLUGIN_VERSION_NOT_FOUND");
  const manifest = parseManifest(version.manifest_json);
  if (!manifest.configPage || !version.config_page_html) throw new Error("PLUGIN_CONFIG_PAGE_NOT_FOUND");
  return { installation, manifest, html: version.config_page_html };
}

export function getPluginConfigPage(user: SessionUser, installationId: string) {
  const page = configPageVersion(user, installationId);
  return { html: page.html, height: page.manifest.configPage!.height };
}

function assertConfigPageRecords(user: SessionUser, installationId: string) {
  const page = configPageVersion(user, installationId);
  if (!page.manifest.permissions.includes("storage:kv")) throw new Error("PLUGIN_CONFIG_PAGE_RECORDS_DENIED");
  return page.installation;
}

export function listPluginRecords(user: SessionUser, installationId: string) {
  assertConfigPageRecords(user, installationId);
  const rows = getDatabase().prepare("SELECT `key`, value_json, updated_at FROM plugin_kv WHERE installation_id = ? ORDER BY `key` ASC").all(installationId) as Array<{ key: string; value_json: string; updated_at: string }>;
  return rows.map((row) => ({ key: row.key, value: parseJson(row.value_json, null), updatedAt: row.updated_at }));
}

export function setPluginRecord(user: SessionUser, installationId: string, key: string, value: unknown) {
  assertConfigPageRecords(user, installationId);
  writeKvAction(installationId, { kind: "kv_set", key, value });
  writeAuditLog(user.id, "hosted_plugin.record.set", "plugin_installation", installationId, { key });
}

export function deletePluginRecord(user: SessionUser, installationId: string, key: string) {
  assertConfigPageRecords(user, installationId);
  writeKvAction(installationId, { kind: "kv_delete", key });
  writeAuditLog(user.id, "hosted_plugin.record.delete", "plugin_installation", installationId, { key });
}

function pluginAssetRoot() {
  const configured = process.env.PLUGIN_ASSET_DIRECTORY;
  if (configured) return path.resolve(configured);
  const databasePath = process.env.DATABASE_PATH;
  return path.resolve(databasePath ? path.dirname(databasePath) : path.join(process.cwd(), "data"), "plugin-assets");
}

function pluginAssetDirectory(installationId: string) {
  const directory = createHash("sha256").update(installationId).digest("hex");
  return path.join(pluginAssetRoot(), directory);
}

function pluginAssetId(value: string) {
  if (!/^[a-f0-9-]{36}\.(?:jpg|png|gif|webp|mp3|wav|ogg|m4a|mp4|webm|pdf|zip|txt|bin)$/.test(value)) throw new Error("PLUGIN_ASSET_ID_INVALID");
  return value;
}

function assetMimeType(assetId: string) {
  const extension = path.extname(assetId).toLowerCase();
  return Object.entries(pluginAssetTypes).find((entry) => entry[1] === extension)?.[0] || "application/octet-stream";
}

function assertConfigPageAssets(user: SessionUser, installationId: string) {
  const page = configPageVersion(user, installationId);
  if (!page.manifest.permissions.includes("qq:api")) throw new Error("PLUGIN_CONFIG_PAGE_ASSETS_DENIED");
}

export function listPluginAssets(user: SessionUser, installationId: string) {
  assertConfigPageAssets(user, installationId);
  const directory = pluginAssetDirectory(installationId);
  if (!fs.existsSync(/* turbopackIgnore: true */ directory)) return [];
  return fs.readdirSync(/* turbopackIgnore: true */ directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[a-f0-9-]{36}\.[a-z0-9]+$/.test(entry.name))
    .map((entry) => {
      const stats = fs.statSync(/* turbopackIgnore: true */ path.join(directory, entry.name));
      return { id: entry.name, mimeType: assetMimeType(entry.name), size: stats.size, createdAt: stats.birthtime.toISOString() };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function createPluginAsset(user: SessionUser, installationId: string, input: { name: string; mimeType: string; base64: string }) {
  assertConfigPageAssets(user, installationId);
  const mimeType = input.mimeType.toLowerCase().split(";", 1)[0].trim() as keyof typeof pluginAssetTypes;
  const extension = pluginAssetTypes[mimeType];
  if (!extension) throw new Error("PLUGIN_ASSET_TYPE_INVALID");
  if (!input.base64 || input.base64.length > Math.ceil(MAX_PLUGIN_ASSET_BYTES * 4 / 3) + 8) throw new Error("PLUGIN_ASSET_TOO_LARGE");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new Error("PLUGIN_ASSET_BASE64_INVALID");
  const bytes = Buffer.from(input.base64, "base64");
  if (!bytes.length || bytes.length > MAX_PLUGIN_ASSET_BYTES) throw new Error("PLUGIN_ASSET_TOO_LARGE");
  const directory = pluginAssetDirectory(installationId);
  fs.mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true, mode: 0o750 });
  const assetId = `${randomUUID()}${extension}`;
  fs.writeFileSync(path.join(/* turbopackIgnore: true */ directory, assetId), bytes, { flag: "wx", mode: 0o640 });
  writeAuditLog(user.id, "hosted_plugin.asset.create", "plugin_installation", installationId, { assetId, name: input.name.slice(0, 200), mimeType, size: bytes.length });
  return { id: assetId, mimeType, size: bytes.length };
}

export function deletePluginAsset(user: SessionUser, installationId: string, assetId: string) {
  assertConfigPageAssets(user, installationId);
  const normalized = pluginAssetId(assetId);
  fs.rmSync(/* turbopackIgnore: true */ path.join(pluginAssetDirectory(installationId), normalized), { force: true });
  writeAuditLog(user.id, "hosted_plugin.asset.delete", "plugin_installation", installationId, { assetId: normalized });
}

export function readPluginAsset(installationId: string, assetId: string) {
  const normalized = pluginAssetId(assetId);
  const filePath = path.join(pluginAssetDirectory(installationId), normalized);
  if (!fs.existsSync(/* turbopackIgnore: true */ filePath)) throw new Error("PLUGIN_ASSET_NOT_FOUND");
  const stats = fs.statSync(/* turbopackIgnore: true */ filePath);
  if (!stats.isFile() || stats.size > MAX_PLUGIN_ASSET_BYTES) throw new Error("PLUGIN_ASSET_NOT_FOUND");
  return { bytes: fs.readFileSync(/* turbopackIgnore: true */ filePath), mimeType: assetMimeType(normalized), size: stats.size };
}

export function listPluginRuns(user: SessionUser, installationId: string, limit = 50) {
  const page = configPageVersion(user, installationId);
  if (!page.manifest.permissions.includes("log:write")) throw new Error("PLUGIN_CONFIG_PAGE_RUNS_DENIED");
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = getDatabase().prepare(`
    SELECT id, event_type, event_key, status, duration_ms, action_count, logs_json, error, created_at
    FROM plugin_runs WHERE installation_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(installationId, boundedLimit) as Array<{
    id: string;
    event_type: string;
    event_key: string | null;
    status: "success" | "skipped" | "failed";
    duration_ms: number;
    action_count: number;
    logs_json: string;
    error: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    eventKey: row.event_key,
    status: row.status,
    durationMs: row.duration_ms,
    actionCount: row.action_count,
    logs: parseJson<unknown[]>(row.logs_json, []),
    error: row.error,
    createdAt: row.created_at,
  }));
}

function readTemplatePath(root: unknown, path: string) {
  const denied = new Set(["__proto__", "prototype", "constructor"]);
  const segments = path.replace(/\[([0-9]+)\]/g, ".$1").replace(/^\./, "").split(".").filter(Boolean);
  let value = root;
  for (const segment of segments) {
    if (denied.has(segment) || value === null || value === undefined || (typeof value !== "object" && typeof value !== "string")) return undefined;
    if (!Object.prototype.hasOwnProperty.call(Object(value), segment)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function renderApiTestValue(value: unknown, sample: Record<string, string | number | boolean>, depth = 0): unknown {
  if (depth > 12) throw new Error("PLUGIN_API_TEST_TEMPLATE_DEPTH");
  if (typeof value === "string") {
    const resolve = (token: string) => {
      const normalized = token.trim();
      if (normalized.startsWith("encode.")) return encodeURIComponent(String(readTemplatePath(sample, normalized.slice(7)) ?? ""));
      if (normalized.startsWith("json.")) return JSON.stringify(readTemplatePath(sample, normalized.slice(5)) ?? null);
      return readTemplatePath(sample, normalized);
    };
    const exact = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
    if (exact) return resolve(exact[1]) ?? "";
    return value
      .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, token: string) => String(resolve(token) ?? ""))
      .replace(/\{([A-Za-z][A-Za-z0-9_.-]*)\}/g, (_match, token: string) => String(readTemplatePath(sample, token) ?? ""));
  }
  if (Array.isArray(value)) return value.map((item) => renderApiTestValue(item, sample, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderApiTestValue(item, sample, depth + 1)]));
  }
  return value;
}

export async function testPluginApi(
  user: SessionUser,
  installationId: string,
  input: { definition: unknown; sample: Record<string, string | number | boolean> },
  dependencies: { request?: typeof requestPluginHttp } = {},
) {
  const page = configPageVersion(user, installationId);
  if (!page.manifest.permissions.includes("http:request")) throw new Error("PLUGIN_CONFIG_PAGE_API_TEST_DENIED");
  const definition = pluginApiDefinitionSchema.parse(input.definition);
  const renderedUrl = String(renderApiTestValue(definition.url, input.sample));
  const controller = new AbortController();
  const startedAt = performance.now();
  const response = await (dependencies.request || requestPluginHttp)({
    url: renderedUrl,
    method: definition.method,
    responseMode: definition.responseMode,
    timeoutMs: definition.timeoutMs,
    headers: renderApiTestValue(definition.headers, input.sample) as Record<string, string>,
    ...(definition.body === undefined ? {} : { body: renderApiTestValue(definition.body, input.sample) }),
  }, controller.signal);
  const raw = definition.responseMode === "media" ? response.url : response.body;
  const extracted = definition.responsePath ? readTemplatePath(raw, definition.responsePath) : raw;
  return {
    ok: response.ok,
    status: response.status,
    url: response.url,
    headers: response.headers,
    body: response.body,
    extracted: extracted ?? null,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}

export function uninstallPlugin(user: SessionUser, installationId: string) {
  const installation = accessibleInstallation(user, installationId);
  getDatabase().prepare("DELETE FROM plugin_installations WHERE id = ?").run(installationId);
  fs.rmSync(/* turbopackIgnore: true */ pluginAssetDirectory(installationId), { recursive: true, force: true });
  writeAuditLog(user.id, "hosted_plugin.uninstall", "plugin_installation", installationId, { projectId: installation.project_id, botId: installation.bot_id });
}

function normalizedMarketplaceText(value: string, field: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`PLUGIN_MARKETPLACE_${field}_INVALID`);
  return normalized;
}

export function updateMarketplacePlugin(user: SessionUser, projectId: string, input: MarketplacePluginUpdate) {
  if (user.role !== "admin") throw new Error("ADMIN_REQUIRED");
  if (!Object.values(input).some((value) => value !== undefined)) throw new Error("PLUGIN_MARKETPLACE_UPDATE_EMPTY");
  const database = getDatabase();
  const listing = database.prepare(`
    SELECT listings.*, versions.manifest_json
    FROM plugin_market_listings listings
    JOIN plugin_versions versions ON versions.id = listings.version_id
    WHERE listings.project_id = ?
  `).get(projectId) as {
    project_id: string; featured: number; price_cents: number; display_name: string | null; display_description: string | null;
    display_author: string | null; display_category: string | null; display_tags_json: string | null; manifest_json: string;
  } | undefined;
  if (!listing) throw new Error("PLUGIN_MARKETPLACE_NOT_FOUND");
  const manifest = parseManifest(listing.manifest_json);
  const tags = input.tags === undefined
    ? (listing.display_tags_json ? parseJson(listing.display_tags_json, manifest.tags) : manifest.tags)
    : [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))];
  if (tags.length > 8 || tags.some((tag) => tag.length > 24)) throw new Error("PLUGIN_MARKETPLACE_TAGS_INVALID");
  if (input.priceCents !== undefined && (!Number.isSafeInteger(input.priceCents) || input.priceCents < 0 || input.priceCents > 100_000_000)) {
    throw new Error("PLUGIN_MARKETPLACE_PRICE_INVALID");
  }
  const next = {
    name: input.name === undefined ? listing.display_name || manifest.name : normalizedMarketplaceText(input.name, "NAME", 80),
    description: input.description === undefined ? listing.display_description || manifest.description : normalizedMarketplaceText(input.description, "DESCRIPTION", 500),
    author: input.author === undefined ? listing.display_author || manifest.author : normalizedMarketplaceText(input.author, "AUTHOR", 80),
    category: input.category === undefined ? listing.display_category || manifest.category : normalizedMarketplaceText(input.category, "CATEGORY", 40),
    tags,
    featured: input.featured === undefined ? Boolean(listing.featured) : input.featured,
    priceCents: input.priceCents === undefined ? listing.price_cents : input.priceCents,
  };
  const now = new Date().toISOString();
  database.prepare(`
    UPDATE plugin_market_listings SET display_name = ?, display_description = ?, display_author = ?,
      display_category = ?, display_tags_json = ?, featured = ?, price_cents = ?, updated_at = ? WHERE project_id = ?
  `).run(next.name, next.description, next.author, next.category, JSON.stringify(next.tags), next.featured ? 1 : 0, next.priceCents, now, projectId);
  writeAuditLog(user.id, "hosted_plugin.marketplace.update", "plugin_project", projectId, next);
  return next;
}

export function removeMarketplacePlugin(user: SessionUser, projectId: string, reason?: string) {
  if (user.role !== "admin") throw new Error("ADMIN_REQUIRED");
  const database = getDatabase();
  const listing = database.prepare("SELECT project_id, version_id FROM plugin_market_listings WHERE project_id = ?").get(projectId) as { project_id: string; version_id: string } | undefined;
  if (!listing) throw new Error("PLUGIN_MARKETPLACE_NOT_FOUND");
  const reviewNote = reason?.trim().slice(0, 500) || "管理员已删除插件市场条目";
  const now = new Date().toISOString();
  let disabledInstallations = 0;
  let cancelledReviews = 0;
  database.transaction(() => {
    disabledInstallations = database.prepare("UPDATE plugin_installations SET enabled = 0, updated_at = ? WHERE project_id = ? AND enabled = 1").run(now, projectId).changes;
    cancelledReviews = database.prepare(`
      UPDATE plugin_market_reviews SET status = 'rejected', pending_project_id = NULL, review_note = ?, reviewed_by = ?, reviewed_at = ?
      WHERE project_id = ? AND status = 'pending'
    `).run(reviewNote, user.id, now, projectId).changes;
    database.prepare("DELETE FROM plugin_market_listings WHERE project_id = ?").run(projectId);
    database.prepare("UPDATE plugin_projects SET status = 'suspended', review_note = ?, updated_at = ? WHERE id = ?").run(reviewNote, now, projectId);
  })();
  const result = { disabledInstallations, cancelledReviews };
  writeAuditLog(user.id, "hosted_plugin.marketplace.remove", "plugin_project", projectId, { ...result, versionId: listing.version_id, reason: reviewNote });
  return result;
}

export function requestPluginReview(user: SessionUser, projectId: string, versionId?: string) {
  const project = accessibleProject(user, projectId);
  if (project.status === "suspended") throw new Error("PLUGIN_PROJECT_SUSPENDED");
  const database = getDatabase();
  const version = versionId
    ? database.prepare("SELECT * FROM plugin_versions WHERE id = ? AND project_id = ? AND status = 'active'").get(versionId, projectId) as VersionRow | undefined
    : database.prepare("SELECT * FROM plugin_versions WHERE project_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(projectId) as VersionRow | undefined;
  if (!version) throw new Error("PLUGIN_VERSION_NOT_FOUND");
  const pending = database.prepare("SELECT id FROM plugin_market_reviews WHERE project_id = ? AND status = 'pending'").get(projectId);
  if (pending) throw new Error("PLUGIN_REVIEW_ALREADY_PENDING");
  const id = randomUUID();
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare(`
      INSERT INTO plugin_market_reviews (id, project_id, version_id, requested_by, status, pending_project_id, requested_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, projectId, version.id, user.id, projectId, now);
    if (project.status !== "published") database.prepare("UPDATE plugin_projects SET status = 'pending', review_note = NULL, updated_at = ? WHERE id = ?").run(now, projectId);
  })();
  writeAuditLog(user.id, "hosted_plugin.review.request", "plugin_project", projectId, { reviewId: id, versionId: version.id });
  return { reviewId: id };
}

export function reviewPlugin(user: SessionUser, reviewId: string, input: { approved: boolean; note?: string; featured?: boolean }) {
  if (user.role !== "admin") throw new Error("ADMIN_REQUIRED");
  const database = getDatabase();
  const review = database.prepare("SELECT * FROM plugin_market_reviews WHERE id = ? AND status = 'pending'").get(reviewId) as { id: string; project_id: string; version_id: string } | undefined;
  if (!review) throw new Error("PLUGIN_REVIEW_NOT_FOUND");
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare(`
      UPDATE plugin_market_reviews SET status = ?, pending_project_id = NULL, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?
    `).run(input.approved ? "approved" : "rejected", input.note?.trim() || null, user.id, now, reviewId);
    if (input.approved) {
      database.prepare(`
        INSERT INTO plugin_market_listings (project_id, version_id, featured, price_cents, published_by, published_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET version_id = excluded.version_id, featured = excluded.featured,
          published_by = excluded.published_by, updated_at = excluded.updated_at
      `).run(review.project_id, review.version_id, input.featured ? 1 : 0, user.id, now, now);
      database.prepare("UPDATE plugin_projects SET status = 'published', review_note = NULL, updated_at = ? WHERE id = ?").run(now, review.project_id);
    } else {
      const listing = database.prepare("SELECT project_id FROM plugin_market_listings WHERE project_id = ?").get(review.project_id);
      database.prepare("UPDATE plugin_projects SET status = ?, review_note = ?, updated_at = ? WHERE id = ?")
        .run(listing ? "published" : "rejected", input.note?.trim() || "审核未通过", now, review.project_id);
    }
  })();
  writeAuditLog(user.id, input.approved ? "hosted_plugin.review.approve" : "hosted_plugin.review.reject", "plugin_project", review.project_id, { reviewId, versionId: review.version_id, note: input.note });
}

function assertActionPermission(action: HostedPluginAction, permissions: Set<string>) {
  const permission = action.kind === "reply" ? `reply:${action.format}` : action.kind === "qq_api" ? "qq:api" : "storage:kv";
  if (!permissions.has(permission)) throw new Error(`PLUGIN_PERMISSION_DENIED:${permission}`);
}

function replyTarget(eventType: string, data: unknown) {
  const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (eventType === "DIRECT_MESSAGE_CREATE") {
    const guildId = payload.guild_id;
    if (typeof guildId === "string" && guildId) return { type: "dms" as const, openid: guildId };
  }
  if (eventType.startsWith("C2C")) {
    const author = payload.author && typeof payload.author === "object" ? payload.author as Record<string, unknown> : {};
    const openid = author.user_openid || author.id || payload.user_openid;
    if (typeof openid === "string" && openid) return { type: "c2c" as const, openid };
  }
  if (eventType.startsWith("GROUP")) {
    const openid = payload.group_openid || payload.group_id;
    if (typeof openid === "string" && openid) return { type: "group" as const, openid };
  }
  if (eventType === "AT_MESSAGE_CREATE" || eventType === "MESSAGE_CREATE") {
    const channelId = payload.channel_id;
    if (typeof channelId === "string" && channelId) return { type: "channel" as const, openid: channelId };
  }
  return null;
}

async function executeAction(botId: string, eventType: string, eventData: unknown, action: HostedPluginAction, messageSequence: number) {
  const client = getBotClientInternal(botId);
  if (action.kind === "qq_api") return client.request(validateQQApiPath(action.path), action.method, action.body);
  if (action.kind !== "reply") return null;
  const target = replyTarget(eventType, eventData);
  if (!target) throw new Error("PLUGIN_REPLY_TARGET_UNAVAILABLE");
  const source = eventData && typeof eventData === "object" ? eventData as Record<string, unknown> : {};
  const context = {
    ...(typeof source.id === "string" ? { msg_id: source.id } : {}),
    ...(typeof source.event_id === "string" ? { event_id: source.event_id } : {}),
    msg_seq: messageSequence,
  };
  const body = action.format === "text"
    ? { content: action.content, msg_type: 0 as const, ...context }
    : action.format === "markdown"
      ? { markdown: action.markdown, msg_type: 2 as const, ...context }
      : action.format === "ark"
        ? { ark: action.ark, msg_type: 3 as const, ...context }
        : { keyboard: action.keyboard, msg_type: 2 as const, ...context };
  if (target.type === "c2c") return client.sendC2CMessage(target.openid, body);
  if (target.type === "group") return client.sendGroupMessage(target.openid, body);
  const path = target.type === "channel" ? `/channels/${encodeURIComponent(target.openid)}/messages` : `/dms/${encodeURIComponent(target.openid)}/messages`;
  const channelBody = action.format === "text" ? { content: action.content, ...context } : body;
  return client.request(path, "POST", channelBody);
}

function writeKvAction(installationId: string, action: Extract<HostedPluginAction, { kind: "kv_set" | "kv_delete" }>) {
  const database = getDatabase();
  if (action.kind === "kv_delete") {
    database.prepare("DELETE FROM plugin_kv WHERE installation_id = ? AND `key` = ?").run(installationId, action.key);
    return;
  }
  let valueJson: string | undefined;
  try { valueJson = JSON.stringify(action.value); }
  catch { throw new Error("PLUGIN_KV_VALUE_INVALID"); }
  if (valueJson === undefined) throw new Error("PLUGIN_KV_VALUE_INVALID");
  if (Buffer.byteLength(valueJson, "utf8") > MAX_KV_VALUE_BYTES) throw new Error("PLUGIN_KV_VALUE_TOO_LARGE");
  const current = database.prepare("SELECT `key`, value_json FROM plugin_kv WHERE installation_id = ?").all(installationId) as Array<{ key: string; value_json: string }>;
  if (!current.some((row) => row.key === action.key) && current.length >= MAX_KV_ENTRIES) throw new Error("PLUGIN_KV_ENTRY_LIMIT");
  const total = current.reduce((sum, row) => sum + Buffer.byteLength(row.value_json, "utf8"), 0)
    - Buffer.byteLength(current.find((row) => row.key === action.key)?.value_json || "", "utf8") + Buffer.byteLength(valueJson, "utf8");
  if (total > MAX_KV_TOTAL_BYTES) throw new Error("PLUGIN_KV_TOTAL_LIMIT");
  const updatedAt = new Date().toISOString();
  database.transaction(() => {
    const existing = database.prepare("SELECT 1 AS found FROM plugin_kv WHERE installation_id = ? AND `key` = ? LIMIT 1").get(installationId, action.key);
    if (existing) {
      database.prepare("UPDATE plugin_kv SET value_json = ?, updated_at = ? WHERE installation_id = ? AND `key` = ?")
        .run(valueJson, updatedAt, installationId, action.key);
    } else {
      database.prepare("INSERT INTO plugin_kv (installation_id, `key`, value_json, updated_at) VALUES (?, ?, ?, ?)")
        .run(installationId, action.key, valueJson, updatedAt);
    }
  })();
}

function eventKey(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  return typeof record.id === "string" ? record.id : typeof record.event_id === "string" ? record.event_id : null;
}

function recordRun(input: { installationId: string; eventType: string; eventData: unknown; status: "success" | "skipped" | "failed"; durationMs: number; actionCount: number; logs: unknown[]; error?: string }) {
  getDatabase().prepare(`
    INSERT INTO plugin_runs
      (id, installation_id, event_type, event_key, status, duration_ms, action_count, logs_json, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), input.installationId, input.eventType, eventKey(input.eventData), input.status, input.durationMs, input.actionCount, JSON.stringify(input.logs), input.error || null, new Date().toISOString());
}

export async function dispatchHostedPlugins(botId: string, eventType: string, eventData: unknown) {
  const database = getDatabase();
  const rows = database.prepare(`
    SELECT installations.id, installations.user_id, installations.bot_id, installations.project_id, installations.priority,
      versions.manifest_json, versions.entry_code
    FROM plugin_installations installations
    JOIN plugin_versions versions ON versions.id = installations.version_id
    JOIN plugin_projects projects ON projects.id = installations.project_id
    JOIN users ON users.id = installations.user_id
    WHERE installations.bot_id = ? AND installations.enabled = 1 AND versions.status = 'active'
      AND projects.status != 'suspended' AND users.status = 'active'
    ORDER BY installations.priority ASC, installations.created_at ASC
  `).all(botId) as InstallationExecutionRow[];
  let stopped = false;
  let executed = 0;
  let messageSequence = 1;
  for (const row of rows) {
    const manifest = parseManifest(row.manifest_json);
    if (!manifest.events.includes("*") && !manifest.events.includes(eventType)) continue;
    const installationConfig = readInstallationConfig(row.id);
    if (eventType === "STARBOT_SCHEDULE_TICK") {
      const rawSchedules = installationConfig.schedules;
      let schedules: unknown = rawSchedules;
      if (typeof rawSchedules === "string") schedules = parseJson<unknown>(rawSchedules, []);
      if (!Array.isArray(schedules) || !schedules.some((schedule) => schedule && typeof schedule === "object" && (schedule as { enabled?: unknown }).enabled !== false)) continue;
    }
    executed += 1;
    let durationMs = 0;
    let actionCount = 0;
    let logs: unknown[] = [];
    try {
      const permissions = new Set(manifest.permissions);
      const result = await executeHostedPlugin({
        code: row.entry_code,
        event: { type: eventType, botId, data: eventData },
        config: installationConfig,
        kv: readInstallationKv(row.id),
        qqRequest: permissions.has("qq:api")
          ? (method, path, body, signal) => getBotClientInternal(botId).request(validateQQApiPath(path), method, body, signal)
          : async () => { throw new Error("PLUGIN_PERMISSION_DENIED:qq:api"); },
        qqMediaUpload: permissions.has("qq:api")
          ? (request, signal) => uploadQQMediaFromUrl(getBotClientInternal(botId), { ...request, srvSendMsg: false }, signal)
          : async () => { throw new Error("PLUGIN_PERMISSION_DENIED:qq:api"); },
        httpRequest: permissions.has("http:request")
          ? (request, signal) => requestPluginHttp(request, signal)
          : async () => { throw new Error("PLUGIN_PERMISSION_DENIED:http:request"); },
      });
      durationMs = result.durationMs;
      actionCount = result.actions.length + result.qqRequestCount + result.httpRequestCount;
      logs = result.logs;
      if (result.logs.length && !permissions.has("log:write")) throw new Error("PLUGIN_PERMISSION_DENIED:log:write");
      for (const action of result.actions) {
        assertActionPermission(action, permissions);
        if (action.kind === "qq_api") validateQQApiPath(action.path);
      }
      for (const action of result.actions) {
        if (action.kind === "kv_set" || action.kind === "kv_delete") writeKvAction(row.id, action);
        else {
          await executeAction(botId, eventType, eventData, action, messageSequence);
          if (action.kind === "reply") messageSequence += 1;
        }
      }
      const now = new Date().toISOString();
      database.prepare("UPDATE plugin_installations SET failure_count = 0, last_error = NULL, last_run_at = ?, updated_at = ? WHERE id = ?").run(now, now, row.id);
      recordRun({ installationId: row.id, eventType, eventData, status: result.actions.length ? "success" : "skipped", durationMs, actionCount, logs });
      if (result.stopPropagation) { stopped = true; break; }
    } catch (error) {
      const message = (error instanceof Error ? error.message : "PLUGIN_EXECUTION_FAILED").slice(0, 1_000);
      const now = new Date().toISOString();
      database.prepare(`
        UPDATE plugin_installations SET failure_count = failure_count + 1, last_error = ?, last_run_at = ?, updated_at = ?,
          enabled = CASE WHEN failure_count + 1 >= ? THEN 0 ELSE enabled END WHERE id = ?
      `).run(message, now, now, AUTO_DISABLE_FAILURES, row.id);
      recordRun({ installationId: row.id, eventType, eventData, status: "failed", durationMs, actionCount, logs, error: message });
    }
  }
  return { executed, stopped };
}

export const hostedPluginLimits = {
  autoDisableFailures: AUTO_DISABLE_FAILURES,
  maxKvEntries: MAX_KV_ENTRIES,
  maxKvValueBytes: MAX_KV_VALUE_BYTES,
  maxKvTotalBytes: MAX_KV_TOTAL_BYTES,
};
