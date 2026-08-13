import "server-only";
import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto-vault";
import { getDatabase, writeAuditLog } from "@/lib/database";
import { hashPassword } from "@/lib/password";
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
  email_registration_verification_enabled: number;
  email_login_enabled: number;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number;
  smtp_starttls: number;
  smtp_from: string;
  smtp_user: string;
  smtp_pass_cipher: string | null;
  install_completed: number;
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

export function getPublicAuthSettings() {
  const row = settingsRow();
  return {
    emailRegistrationVerificationEnabled: Boolean(row.email_registration_verification_enabled),
    emailLoginEnabled: Boolean(row.email_login_enabled),
  };
}

export function getAdminSystemSettings(actor: SessionUser): AdminSystemSettings {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  const row = settingsRow();
  return {
    site: publicSettings(row),
    qq: { enabled: Boolean(row.qq_login_enabled), appId: row.qq_app_id, appSecretConfigured: Boolean(row.qq_app_secret_cipher || process.env.QQ_LOGIN_APP_SECRET), redirectUri: row.qq_redirect_uri },
    email: {
      registrationVerificationEnabled: Boolean(row.email_registration_verification_enabled),
      loginEnabled: Boolean(row.email_login_enabled),
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      smtpSecure: Boolean(row.smtp_secure),
      smtpStarttls: Boolean(row.smtp_starttls),
      smtpFrom: row.smtp_from,
      smtpUser: row.smtp_user,
      smtpPassConfigured: Boolean(row.smtp_pass_cipher || process.env.SMTP_PASS),
    },
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

export function installationStatus() {
  const row = settingsRow();
  const adminCount = getDatabase().prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get() as { count: number };
  return { needed: !Boolean(row.install_completed) || adminCount.count === 0 };
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

export function updateEmailSettings(actor: SessionUser, input: {
  registrationVerificationEnabled: boolean;
  loginEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpStarttls: boolean;
  smtpFrom: string;
  smtpUser: string;
  smtpPass?: string;
  clearPass?: boolean;
}) {
  if (actor.role !== "admin") throw new Error("ADMIN_REQUIRED");
  const current = settingsRow();
  const passCipher = input.clearPass ? null : input.smtpPass ? encryptSecret(input.smtpPass) : current.smtp_pass_cipher;
  if ((input.registrationVerificationEnabled || input.loginEnabled) && (!input.smtpHost || !input.smtpFrom || !(passCipher || process.env.SMTP_PASS))) {
    throw new Error("EMAIL_CONFIG_INCOMPLETE");
  }
  getDatabase().prepare(`
    UPDATE system_settings SET
      email_registration_verification_enabled = ?,
      email_login_enabled = ?,
      smtp_host = ?,
      smtp_port = ?,
      smtp_secure = ?,
      smtp_starttls = ?,
      smtp_from = ?,
      smtp_user = ?,
      smtp_pass_cipher = ?,
      updated_by = ?,
      updated_at = ?
    WHERE id = 1
  `).run(
    input.registrationVerificationEnabled ? 1 : 0,
    input.loginEnabled ? 1 : 0,
    input.smtpHost,
    input.smtpPort,
    input.smtpSecure ? 1 : 0,
    input.smtpStarttls ? 1 : 0,
    input.smtpFrom,
    input.smtpUser,
    passCipher,
    actor.id,
    new Date().toISOString(),
  );
  writeAuditLog(actor.id, "system.email.update", "system_settings", "1", {
    registrationVerificationEnabled: input.registrationVerificationEnabled,
    loginEnabled: input.loginEnabled,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
  });
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

export function getEmailConfig() {
  const row = settingsRow();
  const smtpHost = row.smtp_host || process.env.SMTP_HOST || "";
  const smtpPort = row.smtp_host ? row.smtp_port : Number(process.env.SMTP_PORT || (process.env.SMTP_SECURE === "true" ? 465 : 587));
  const smtpSecure = row.smtp_host ? Boolean(row.smtp_secure) : process.env.SMTP_SECURE === "true";
  const smtpStarttls = row.smtp_host ? Boolean(row.smtp_starttls) : process.env.SMTP_STARTTLS !== "false";
  const smtpFrom = row.smtp_from || process.env.SMTP_FROM || "";
  const smtpUser = row.smtp_user || process.env.SMTP_USER || "";
  const smtpPass = row.smtp_pass_cipher ? decryptSecret(row.smtp_pass_cipher) : process.env.SMTP_PASS || "";
  return {
    registrationVerificationEnabled: Boolean(row.email_registration_verification_enabled),
    loginEnabled: Boolean(row.email_login_enabled),
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpStarttls,
    smtpFrom,
    smtpUser,
    smtpPass,
    configured: Boolean(smtpHost && smtpFrom && smtpPass),
  };
}

export function completeInstallation(input: {
  siteName: string;
  siteTagline: string;
  siteDescription: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  logo?: { mimeType: string; bytes: Uint8Array };
  favicon?: { mimeType: string; bytes: Uint8Array };
}) {
  if (!installationStatus().needed) throw new Error("INSTALL_ALREADY_COMPLETED");
  const database = getDatabase();
  const now = new Date().toISOString();
  const adminId = randomUUID();
  database.transaction(() => {
    database.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, bot_quota, status, created_at)
      VALUES (?, ?, ?, ?, 'admin', 12, 'active', ?)
    `).run(adminId, input.adminName.trim(), input.adminEmail.trim().toLowerCase(), hashPassword(input.adminPassword), now);
    database.prepare(`
      INSERT INTO user_memberships (user_id, plan_id, status, starts_at, expires_at, assigned_by, updated_at)
      VALUES (?, 'pro', 'active', ?, NULL, NULL, ?)
    `).run(adminId, now, now);
    database.prepare(`
      UPDATE system_settings SET
        site_name = ?,
        site_tagline = ?,
        site_description = ?,
        copyright_text = ?,
        site_logo_mime = ?,
        site_logo_blob = ?,
        site_favicon_mime = ?,
        site_favicon_blob = ?,
        install_completed = 1,
        updated_by = ?,
        updated_at = ?
      WHERE id = 1
    `).run(
      input.siteName,
      input.siteTagline,
      input.siteDescription,
      input.siteName,
      input.logo?.mimeType || null,
      input.logo ? Buffer.from(input.logo.bytes) : null,
      input.favicon?.mimeType || null,
      input.favicon ? Buffer.from(input.favicon.bytes) : null,
      adminId,
      now,
    );
    writeAuditLog(adminId, "system.install.complete", "system_settings", "1", { siteName: input.siteName });
  })();
  const admin = database.prepare(`
    SELECT users.*,
      COALESCE(user_memberships.plan_id, 'free') AS membership_plan,
      COALESCE(membership_plans.name, '免费版') AS membership_name
    FROM users
    LEFT JOIN user_memberships ON user_memberships.user_id = users.id AND user_memberships.status = 'active'
    LEFT JOIN membership_plans ON membership_plans.id = user_memberships.plan_id
    WHERE users.id = ?
  `).get(adminId) as { id: string; name: string; email: string; role: "admin"; bot_quota: number; membership_plan: "pro"; membership_name: string };
  return {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    botQuota: admin.bot_quota,
    membershipPlan: admin.membership_plan,
    membershipName: admin.membership_name,
  };
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

export function getPaymentPublicConfig() {
  const row = settingsRow();
  return {
    enabled: Boolean(row.payment_enabled),
    provider: row.payment_provider,
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
