export const MYSQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(191) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  bot_quota INT NOT NULL DEFAULT 3,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at VARCHAR(40) NOT NULL,
  last_login_at VARCHAR(40)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at VARCHAR(40) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bots (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  name VARCHAR(255) NOT NULL,
  app_id VARCHAR(191) NOT NULL,
  client_secret_cipher LONGTEXT NOT NULL,
  environment VARCHAR(32) NOT NULL,
  connection_mode VARCHAR(32) NOT NULL DEFAULT 'websocket',
  intents INT NOT NULL DEFAULT 1107300352,
  status VARCHAR(32) NOT NULL DEFAULT 'offline',
  gateway_session_id VARCHAR(255),
  gateway_sequence INT,
  last_seen_at VARCHAR(40),
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  auto_connect TINYINT NOT NULL DEFAULT 0,
  UNIQUE KEY bots_user_app_idx (user_id, app_id),
  CONSTRAINT bots_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_logs (
  id VARCHAR(191) PRIMARY KEY,
  bot_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  scene VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  latency_ms INT NOT NULL DEFAULT 0,
  content LONGTEXT NOT NULL,
  payload_json LONGTEXT NOT NULL,
  trace_id VARCHAR(255),
  received_at VARCHAR(40) NOT NULL,
  KEY event_logs_bot_received_idx (bot_id, received_at),
  CONSTRAINT event_logs_bot_fk FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugins (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  bot_id VARCHAR(191) NOT NULL,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(191) NOT NULL,
  version VARCHAR(64) NOT NULL,
  runtime VARCHAR(32) NOT NULL DEFAULT 'sdk',
  events_json VARCHAR(4096) NOT NULL,
  permissions_json VARCHAR(4096) NOT NULL,
  signing_secret_cipher LONGTEXT,
  enabled TINYINT NOT NULL DEFAULT 1,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY plugins_user_slug_idx (user_id, slug),
  CONSTRAINT plugins_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT plugins_bot_fk FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_projects (
  id VARCHAR(191) PRIMARY KEY,
  owner_user_id VARCHAR(191) NOT NULL,
  slug VARCHAR(191) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description LONGTEXT NOT NULL,
  author VARCHAR(255) NOT NULL,
  category VARCHAR(128) NOT NULL,
  tags_json VARCHAR(4096) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'private',
  review_note LONGTEXT,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY plugin_projects_owner_slug_idx (owner_user_id, slug),
  CONSTRAINT plugin_projects_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_versions (
  id VARCHAR(191) PRIMARY KEY,
  project_id VARCHAR(191) NOT NULL,
  version VARCHAR(64) NOT NULL,
  manifest_json LONGTEXT NOT NULL,
  entry_code LONGTEXT NOT NULL,
  config_page_html LONGTEXT,
  readme LONGTEXT,
  package_sha256 VARCHAR(255) NOT NULL,
  package_size INT NOT NULL DEFAULT 0,
  validation_json LONGTEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at VARCHAR(40) NOT NULL,
  UNIQUE KEY plugin_versions_project_version_idx (project_id, version),
  KEY plugin_versions_project_created_idx (project_id, created_at),
  CONSTRAINT plugin_versions_project_fk FOREIGN KEY (project_id) REFERENCES plugin_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_installations (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  bot_id VARCHAR(191) NOT NULL,
  project_id VARCHAR(191) NOT NULL,
  version_id VARCHAR(191) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 0,
  priority INT NOT NULL DEFAULT 50,
  failure_count INT NOT NULL DEFAULT 0,
  last_error LONGTEXT,
  last_run_at VARCHAR(40),
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY plugin_installations_bot_project_idx (bot_id, project_id),
  KEY plugin_installations_bot_enabled_idx (bot_id, enabled, priority),
  CONSTRAINT plugin_installations_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT plugin_installations_bot_fk FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
  CONSTRAINT plugin_installations_project_fk FOREIGN KEY (project_id) REFERENCES plugin_projects(id) ON DELETE CASCADE,
  CONSTRAINT plugin_installations_version_fk FOREIGN KEY (version_id) REFERENCES plugin_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_config_values (
  installation_id VARCHAR(191) NOT NULL,
  ` + "`key`" + ` VARCHAR(191) NOT NULL,
  value_json LONGTEXT NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (installation_id, ` + "`key`" + `),
  CONSTRAINT plugin_config_installation_fk FOREIGN KEY (installation_id) REFERENCES plugin_installations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_kv (
  installation_id VARCHAR(191) NOT NULL,
  ` + "`key`" + ` VARCHAR(191) NOT NULL,
  value_json LONGTEXT NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (installation_id, ` + "`key`" + `),
  CONSTRAINT plugin_kv_installation_fk FOREIGN KEY (installation_id) REFERENCES plugin_installations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_runs (
  id VARCHAR(191) PRIMARY KEY,
  installation_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  event_key VARCHAR(255),
  status VARCHAR(32) NOT NULL,
  duration_ms INT NOT NULL DEFAULT 0,
  action_count INT NOT NULL DEFAULT 0,
  logs_json LONGTEXT NOT NULL,
  error LONGTEXT,
  created_at VARCHAR(40) NOT NULL,
  KEY plugin_runs_installation_created_idx (installation_id, created_at),
  CONSTRAINT plugin_runs_installation_fk FOREIGN KEY (installation_id) REFERENCES plugin_installations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_market_reviews (
  id VARCHAR(191) PRIMARY KEY,
  project_id VARCHAR(191) NOT NULL,
  version_id VARCHAR(191) NOT NULL,
  requested_by VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL,
  pending_project_id VARCHAR(191),
  review_note LONGTEXT,
  reviewed_by VARCHAR(191),
  requested_at VARCHAR(40) NOT NULL,
  reviewed_at VARCHAR(40),
  UNIQUE KEY plugin_market_reviews_pending_idx (pending_project_id),
  KEY plugin_market_reviews_status_requested_idx (status, requested_at),
  CONSTRAINT plugin_market_reviews_project_fk FOREIGN KEY (project_id) REFERENCES plugin_projects(id) ON DELETE CASCADE,
  CONSTRAINT plugin_market_reviews_version_fk FOREIGN KEY (version_id) REFERENCES plugin_versions(id) ON DELETE CASCADE,
  CONSTRAINT plugin_market_reviews_requested_by_fk FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT plugin_market_reviews_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_market_listings (
  project_id VARCHAR(191) PRIMARY KEY,
  version_id VARCHAR(191) NOT NULL,
  featured TINYINT NOT NULL DEFAULT 0,
  price_cents INT NOT NULL DEFAULT 0,
  display_name VARCHAR(255),
  display_description LONGTEXT,
  display_author VARCHAR(255),
  display_category VARCHAR(128),
  display_tags_json VARCHAR(4096),
  published_by VARCHAR(191),
  published_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  CONSTRAINT plugin_market_listings_project_fk FOREIGN KEY (project_id) REFERENCES plugin_projects(id) ON DELETE CASCADE,
  CONSTRAINT plugin_market_listings_version_fk FOREIGN KEY (version_id) REFERENCES plugin_versions(id),
  CONSTRAINT plugin_market_listings_published_by_fk FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(191) PRIMARY KEY,
  actor_user_id VARCHAR(191),
  action VARCHAR(191) NOT NULL,
  target_type VARCHAR(128) NOT NULL,
  target_id VARCHAR(191),
  metadata_json LONGTEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  CONSTRAINT audit_logs_actor_fk FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS membership_plans (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  bot_quota INT NOT NULL,
  plugin_quota INT NOT NULL,
  event_retention_days INT NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  monthly_price_cents INT NOT NULL DEFAULT 0,
  quarterly_price_cents INT NOT NULL DEFAULT 0,
  yearly_price_cents INT NOT NULL DEFAULT 0,
  features_json VARCHAR(4096) NOT NULL DEFAULT '[]'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_memberships (
  user_id VARCHAR(191) PRIMARY KEY,
  plan_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  starts_at VARCHAR(40) NOT NULL,
  expires_at VARCHAR(40),
  assigned_by VARCHAR(191),
  updated_at VARCHAR(40) NOT NULL,
  CONSTRAINT user_memberships_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_memberships_plan_fk FOREIGN KEY (plan_id) REFERENCES membership_plans(id),
  CONSTRAINT user_memberships_assigned_by_fk FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  id INT PRIMARY KEY,
  site_name VARCHAR(255) NOT NULL,
  site_tagline VARCHAR(255) NOT NULL,
  site_description VARCHAR(1000) NOT NULL,
  site_logo_mime VARCHAR(128),
  site_logo_blob MEDIUMBLOB,
  site_favicon_mime VARCHAR(128),
  site_favicon_blob MEDIUMBLOB,
  icp_code VARCHAR(255) NOT NULL DEFAULT '',
  icp_url VARCHAR(2048) NOT NULL DEFAULT 'https://beian.miit.gov.cn/',
  police_code VARCHAR(255) NOT NULL DEFAULT '',
  police_url VARCHAR(2048) NOT NULL DEFAULT '',
  copyright_text VARCHAR(255) NOT NULL DEFAULT '',
  qq_login_enabled TINYINT NOT NULL DEFAULT 0,
  qq_app_id VARCHAR(191) NOT NULL DEFAULT '',
  qq_app_secret_cipher LONGTEXT,
  qq_redirect_uri VARCHAR(2048) NOT NULL DEFAULT '',
  payment_enabled TINYINT NOT NULL DEFAULT 0,
  payment_provider VARCHAR(32) NOT NULL DEFAULT 'sandbox',
  epay_gateway_url VARCHAR(2048) NOT NULL DEFAULT '',
  epay_pid VARCHAR(255) NOT NULL DEFAULT '',
  epay_key_cipher LONGTEXT,
  manual_payment_instructions LONGTEXT NOT NULL,
  email_registration_verification_enabled TINYINT NOT NULL DEFAULT 0,
  email_login_enabled TINYINT NOT NULL DEFAULT 0,
  smtp_host VARCHAR(255) NOT NULL DEFAULT '',
  smtp_port INT NOT NULL DEFAULT 587,
  smtp_secure TINYINT NOT NULL DEFAULT 0,
  smtp_starttls TINYINT NOT NULL DEFAULT 1,
  smtp_from VARCHAR(255) NOT NULL DEFAULT '',
  smtp_user VARCHAR(255) NOT NULL DEFAULT '',
  smtp_pass_cipher LONGTEXT,
  install_completed TINYINT NOT NULL DEFAULT 0,
  updated_by VARCHAR(191),
  updated_at VARCHAR(40) NOT NULL,
  CONSTRAINT system_settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_asset_chunks (
  kind VARCHAR(16) NOT NULL,
  chunk_index INT NOT NULL,
  data_blob MEDIUMBLOB NOT NULL,
  PRIMARY KEY (kind, chunk_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS membership_orders (
  id VARCHAR(191) PRIMARY KEY,
  order_no VARCHAR(191) NOT NULL UNIQUE,
  user_id VARCHAR(191) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  billing_cycle VARCHAR(32) NOT NULL,
  payment_channel VARCHAR(32) NOT NULL,
  amount_cents INT NOT NULL,
  provider VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  payment_url VARCHAR(2048),
  provider_trade_no VARCHAR(255),
  payment_note LONGTEXT,
  created_at VARCHAR(40) NOT NULL,
  paid_at VARCHAR(40),
  expires_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  KEY membership_orders_user_created_idx (user_id, created_at),
  KEY membership_orders_status_created_idx (status, created_at),
  CONSTRAINT membership_orders_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT membership_orders_plan_fk FOREIGN KEY (plan_id) REFERENCES membership_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_deliveries (
  id VARCHAR(191) PRIMARY KEY,
  plugin_id VARCHAR(191) NOT NULL,
  bot_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  payload_json LONGTEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at VARCHAR(40) NOT NULL,
  response_status INT,
  last_error LONGTEXT,
  lease_owner VARCHAR(255),
  lease_expires_at BIGINT,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  KEY plugin_deliveries_due_idx (status, next_attempt_at),
  CONSTRAINT plugin_deliveries_plugin_fk FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE,
  CONSTRAINT plugin_deliveries_bot_fk FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key VARCHAR(191) PRIMARY KEY,
  attempts INT NOT NULL,
  window_started_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id VARCHAR(191) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  purpose VARCHAR(32) NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  expires_at VARCHAR(40) NOT NULL,
  consumed_at VARCHAR(40),
  created_at VARCHAR(40) NOT NULL,
  sent_at VARCHAR(40) NOT NULL,
  KEY email_verification_codes_lookup_idx (email, purpose, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider VARCHAR(64) NOT NULL,
  provider_account_id VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  profile_json LONGTEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (provider, provider_account_id),
  CONSTRAINT oauth_accounts_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash VARCHAR(255) PRIMARY KEY,
  provider VARCHAR(64) NOT NULL,
  redirect_uri VARCHAR(2048) NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_request_nonces (
  plugin_id VARCHAR(191) NOT NULL,
  nonce_hash VARCHAR(255) NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (plugin_id, nonce_hash),
  CONSTRAINT plugin_request_nonces_plugin_fk FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gateway_shard_sessions (
  bot_id VARCHAR(191) NOT NULL,
  shard_id INT NOT NULL,
  shard_count INT NOT NULL,
  session_id VARCHAR(255),
  sequence INT,
  status VARCHAR(32) NOT NULL,
  last_ack_at BIGINT,
  updated_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (bot_id, shard_id),
  CONSTRAINT gateway_shard_sessions_bot_fk FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gateway_leases (
  bot_id VARCHAR(191) PRIMARY KEY,
  owner_id VARCHAR(255) NOT NULL,
  expires_at BIGINT NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  KEY gateway_leases_expiry_idx (expires_at),
  CONSTRAINT gateway_leases_bot_fk FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_receipts (
  bot_id VARCHAR(191) NOT NULL,
  source VARCHAR(32) NOT NULL,
  event_key VARCHAR(255) NOT NULL,
  received_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (bot_id, event_key),
  KEY event_receipts_received_idx (received_at),
  CONSTRAINT event_receipts_bot_fk FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(191) PRIMARY KEY,
  applied_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export type MySqlIndexedIdentifierLength = 64 | 191;

export function mysqlSchemaForIndexedIdentifierLength(indexedIdentifierLength: MySqlIndexedIdentifierLength) {
  if (indexedIdentifierLength === 191) return MYSQL_SCHEMA;
  return MYSQL_SCHEMA
    .replaceAll("VARCHAR(191)", "VARCHAR(64)")
    .replaceAll("email VARCHAR(255)", "email VARCHAR(160)")
    .replace("token_hash VARCHAR(255) NOT NULL UNIQUE", "token_hash VARCHAR(64) NOT NULL UNIQUE")
    .replace("state_hash VARCHAR(255) PRIMARY KEY", "state_hash VARCHAR(64) PRIMARY KEY")
    .replace("nonce_hash VARCHAR(255) NOT NULL", "nonce_hash VARCHAR(64) NOT NULL")
    .replace("event_key VARCHAR(255) NOT NULL", "event_key VARCHAR(127) NOT NULL")
    .replace(
      "KEY email_verification_codes_lookup_idx (email, purpose, created_at)",
      "KEY email_verification_codes_lookup_idx (email(112), purpose, created_at)",
    );
}
