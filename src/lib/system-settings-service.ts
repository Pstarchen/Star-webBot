import "server-only";
import { decryptSecret, encryptSecret } from "@/lib/crypto-vault";
import { getDatabase, writeAuditLog } from "@/lib/database";
import type { AdminSystemSettings, PaymentProvider, SessionUser, SitePublicSettings } from "@/types/platform";

type SettingsRow = {
  site_name: string;
  site_tagline: string;
  site_description: string;
  site_logo_mime: string | null;
  site_favicon_mime: string | null;
  icp_code: string;
  icp_url: string;
  police_code: string;
  police_url: string;
  copyright_text: string;
  qq_login_enabled: number;
  qq_app_id: string;
  qq_app_secret_cipher: string | null;
  qq_redirect_uri: string;
  payment_enabled: number;
  payment_provider: PaymentProvider;
  epay_gateway_url: string;
  epay_pid: string;
  epay_key_cipher: string | null;
  manual_payment_instructions: string;
};

function settingsRow() {
  return getDatabase().prepare("SELECT * FROM system_settings WHERE id = 1").get() as SettingsRow;
}

function publicSettings(row: SettingsRow): SitePublicSettings {
  return {
    siteName: row.site_name,
    siteTagline: row.site_tagline,
    siteDescription: row.site_description,
    logoUrl: row.site_logo_mime ? "/api/site-assets/logo" : null,
    faviconUrl: row.site_favicon_mime ? "/api/site-assets/favicon" : null,
    icpCode: row.icp_code,
    icpUrl: row.icp_url,
    policeCode: row.police_code,
    policeUrl: row.police_url,
    copyrightText: row.copyright_text,
  };
}

export function getPublicSiteSettings() {
  return publicSettings(settingsRow());
}

export function getAdminSystemSettings(actor: SessionUser): AdminSystemSettings {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  const row = settingsRow();
  return {
    site: publicSettings(row),
    qq: { enabled: Boolean(row.qq_login_enabled), appId: row.qq_app_id, appSecretConfigured: Boolean(row.qq_app_secret_cipher || process.env.QQ_LOGIN_APP_SECRET), redirectUri: row.qq_redirect_uri },
    payment: {
      enabled: Boolean(row.payment_enabled),
      provider: row.payment_provider,
      epayGatewayUrl: row.epay_gateway_url,
      epayPid: row.epay_pid,
      epayKeyConfigured: Boolean(row.epay_key_cipher),
      manualInstructions: row.manual_payment_instructions,
    },
  };
}

export function updateSiteSettings(actor: SessionUser, input: Omit<SitePublicSettings, "logoUrl" | "faviconUrl">) {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  getDatabase().prepare(`
    UPDATE system_settings SET site_name = ?, site_tagline = ?, site_description = ?, icp_code = ?, icp_url = ?, police_code = ?, police_url = ?, copyright_text = ?, updated_by = ?, updated_at = ? WHERE id = 1
  `).run(input.siteName, input.siteTagline, input.siteDescription, input.icpCode, input.icpUrl, input.policeCode, input.policeUrl, input.copyrightText, actor.id, new Date().toISOString());
  writeAuditLog(actor.id, "system.site.update", "system_settings", "1");
  return getAdminSystemSettings(actor);
}

export function updateQQLoginSettings(actor: SessionUser, input: { enabled: boolean; appId: string; appSecret?: string; clearSecret?: boolean; redirectUri: string }) {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  const current = settingsRow();
  const secretCipher = input.clearSecret ? null : input.appSecret ? encryptSecret(input.appSecret) : current.qq_app_secret_cipher;
  if (input.enabled && (!input.appId || !(secretCipher || process.env.QQ_LOGIN_APP_SECRET))) throw new Error("QQ_LOGIN_CONFIG_INCOMPLETE");
  getDatabase().prepare(`
    UPDATE system_settings SET qq_login_enabled = ?, qq_app_id = ?, qq_app_secret_cipher = ?, qq_redirect_uri = ?, updated_by = ?, updated_at = ? WHERE id = 1
  `).run(input.enabled ? 1 : 0, input.appId, secretCipher, input.redirectUri, actor.id, new Date().toISOString());
  writeAuditLog(actor.id, "system.qq_login.update", "system_settings", "1", { enabled: input.enabled, appId: input.appId });
  return getAdminSystemSettings(actor);
}

export function updatePaymentSettings(actor: SessionUser, input: { enabled: boolean; provider: PaymentProvider; epayGatewayUrl: string; epayPid: string; epayKey?: string; clearKey?: boolean; manualInstructions: string }) {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  const current = settingsRow();
  const keyCipher = input.clearKey ? null : input.epayKey ? encryptSecret(input.epayKey) : current.epay_key_cipher;
  if (input.enabled && input.provider === "epay" && (!input.epayGatewayUrl || !input.epayPid || !keyCipher)) throw new Error("PAYMENT_CONFIG_INCOMPLETE");
  if (input.enabled && input.provider === "sandbox" && process.env.NODE_ENV === "production") throw new Error("PAYMENT_SANDBOX_PRODUCTION_DISABLED");
  getDatabase().prepare(`
    UPDATE system_settings SET payment_enabled = ?, payment_provider = ?, epay_gateway_url = ?, epay_pid = ?, epay_key_cipher = ?, manual_payment_instructions = ?, updated_by = ?, updated_at = ? WHERE id = 1
  `).run(input.enabled ? 1 : 0, input.provider, input.epayGatewayUrl, input.epayPid, keyCipher, input.manualInstructions, actor.id, new Date().toISOString());
  writeAuditLog(actor.id, "system.payment.update", "system_settings", "1", { enabled: input.enabled, provider: input.provider });
  return getAdminSystemSettings(actor);
}

export function getQQLoginConfig() {
  const row = settingsRow();
  const appId = row.qq_app_id || process.env.QQ_LOGIN_APP_ID || "";
  const appSecret = row.qq_app_secret_cipher ? decryptSecret(row.qq_app_secret_cipher) : process.env.QQ_LOGIN_APP_SECRET || "";
  const enabled = Boolean(row.qq_login_enabled || (!row.qq_app_id && process.env.QQ_LOGIN_APP_ID && process.env.QQ_LOGIN_APP_SECRET));
  return { enabled, appId, appSecret, redirectUri: row.qq_redirect_uri || process.env.QQ_LOGIN_REDIRECT_URI || "" };
}

export function getPaymentConfig() {
  const row = settingsRow();
  return {
    enabled: Boolean(row.payment_enabled),
    provider: row.payment_provider,
    epayGatewayUrl: row.epay_gateway_url,
    epayPid: row.epay_pid,
    epayKey: row.epay_key_cipher ? decryptSecret(row.epay_key_cipher) : "",
    manualInstructions: row.manual_payment_instructions,
  };
}

export function setSiteAsset(actor: SessionUser, kind: "logo" | "favicon", mimeType: string, bytes: Uint8Array) {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  const columnPrefix = kind === "logo" ? "site_logo" : "site_favicon";
  getDatabase().prepare(`UPDATE system_settings SET ${columnPrefix}_mime = ?, ${columnPrefix}_blob = ?, updated_by = ?, updated_at = ? WHERE id = 1`)
    .run(mimeType, Buffer.from(bytes), actor.id, new Date().toISOString());
  writeAuditLog(actor.id, `system.${kind}.update`, "system_settings", "1", { mimeType, bytes: bytes.length });
}

export function getSiteAsset(kind: "logo" | "favicon") {
  const columnPrefix = kind === "logo" ? "site_logo" : "site_favicon";
  return getDatabase().prepare(`SELECT ${columnPrefix}_mime AS mime, ${columnPrefix}_blob AS data FROM system_settings WHERE id = 1`).get() as { mime: string | null; data: Buffer | null };
}
