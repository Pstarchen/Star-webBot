import "server-only";
import fs from "node:fs";
import path from "node:path";
import { decryptSecret, encryptSecret } from "@/lib/crypto-vault";
import type { MySqlConnectionConfig } from "@/lib/mysql-sync";

export type DatabaseProvider = "sqlite" | "mysql";

export type DatabaseConfiguration =
  | { provider: "sqlite"; path: string; source: "default" | "environment" | "file" }
  | { provider: "mysql"; config: MySqlConnectionConfig; source: "environment" | "file" };

export type DatabaseConfigurationInput =
  | { provider: "sqlite"; path: string }
  | { provider: "mysql"; host: string; port: number; user: string; password: string; database: string; ssl: boolean };

type StoredDatabaseConfiguration =
  | { version: 1; provider: "sqlite"; path: string }
  | { version: 1; provider: "mysql"; host: string; port: number; user: string; passwordCipher: string; database: string; ssl: boolean };

export type DatabaseConfigurationFileSnapshot = {
  path: string;
  contents: Buffer | null;
};

function configuredSqlitePath() {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || path.join(process.cwd(), "data", "starbot.db"));
}

function configFilePath() {
  if (process.env.DATABASE_CONFIG_PATH) return path.resolve(process.env.DATABASE_CONFIG_PATH);
  return path.join(path.dirname(configuredSqlitePath()), "starbot.database-config.json");
}

function mysqlConfigFromEnvironment(): MySqlConnectionConfig {
  const database = process.env.MYSQL_DATABASE?.trim();
  const user = process.env.MYSQL_USER?.trim();
  const port = Number(process.env.MYSQL_PORT || 3306);
  if (!database || !user || !Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("MYSQL_ENVIRONMENT_INVALID");
  return {
    host: process.env.MYSQL_HOST?.trim() || "127.0.0.1",
    port,
    user,
    password: process.env.MYSQL_PASSWORD || "",
    database,
    ssl: process.env.MYSQL_SSL === "true",
  };
}

function readStoredConfiguration(): StoredDatabaseConfiguration | null {
  const filePath = configFilePath();
  if (!fs.existsSync(/* turbopackIgnore: true */ filePath)) return null;
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ filePath, "utf8"));
  } catch {
    throw new Error("DATABASE_CONFIG_INVALID");
  }
  if (!value || typeof value !== "object") throw new Error("DATABASE_CONFIG_INVALID");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || (record.provider !== "sqlite" && record.provider !== "mysql")) throw new Error("DATABASE_CONFIG_INVALID");
  if (record.provider === "sqlite") {
    if (typeof record.path !== "string" || !record.path.trim()) throw new Error("DATABASE_CONFIG_INVALID");
    return { version: 1, provider: "sqlite", path: record.path };
  }
  if (typeof record.host !== "string" || typeof record.port !== "number" || typeof record.user !== "string" || typeof record.passwordCipher !== "string" || typeof record.database !== "string" || typeof record.ssl !== "boolean") {
    throw new Error("DATABASE_CONFIG_INVALID");
  }
  return {
    version: 1,
    provider: "mysql",
    host: record.host,
    port: record.port,
    user: record.user,
    passwordCipher: record.passwordCipher,
    database: record.database,
    ssl: record.ssl,
  };
}

export function databaseConfigurationFromInput(input: DatabaseConfigurationInput): DatabaseConfiguration {
  if (input.provider === "sqlite") {
    const sqlitePath = input.path.trim();
    if (!sqlitePath || sqlitePath.length > 1_024 || sqlitePath.includes("\0")) throw new Error("SQLITE_PATH_INVALID");
    return { provider: "sqlite", path: path.resolve(sqlitePath), source: "file" };
  }

  const host = input.host.trim();
  const user = input.user.trim();
  const database = input.database.trim();
  if (!host || host.length > 255 || !user || user.length > 255 || !database || database.length > 255 || !Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new Error("MYSQL_CONFIGURATION_INVALID");
  }
  return {
    provider: "mysql",
    source: "file",
    config: { host, port: input.port, user, password: input.password, database, ssl: input.ssl },
  };
}

export function getDatabaseConfiguration(): DatabaseConfiguration {
  const provider = process.env.DATABASE_PROVIDER?.trim().toLowerCase();
  if (provider) {
    if (provider === "sqlite") return { provider: "sqlite", path: configuredSqlitePath(), source: "environment" };
    if (provider === "mysql") return { provider: "mysql", config: mysqlConfigFromEnvironment(), source: "environment" };
    throw new Error("DATABASE_PROVIDER_INVALID");
  }

  const stored = readStoredConfiguration();
  if (!stored) return { provider: "sqlite", path: configuredSqlitePath(), source: "default" };
  if (stored.provider === "sqlite") return { provider: "sqlite", path: path.resolve(/* turbopackIgnore: true */ stored.path), source: "file" };
  return {
    provider: "mysql",
    source: "file",
    config: {
      host: stored.host,
      port: stored.port,
      user: stored.user,
      password: decryptSecret(stored.passwordCipher),
      database: stored.database,
      ssl: stored.ssl,
    },
  };
}

export function databaseConfigurationForSetup() {
  const configuredProvider = process.env.DATABASE_PROVIDER?.trim().toLowerCase();
  const stored = configuredProvider ? null : readStoredConfiguration();
  if (configuredProvider === "mysql") {
    const config = mysqlConfigFromEnvironment();
    return { provider: "mysql" as const, locked: true, sqlitePath: configuredSqlitePath(), mysql: { host: config.host, port: config.port, user: config.user, database: config.database, ssl: config.ssl } };
  }
  if (configuredProvider === "sqlite") return { provider: "sqlite" as const, locked: true, sqlitePath: configuredSqlitePath(), mysql: { host: "127.0.0.1", port: 3306, user: "", database: "", ssl: false } };
  if (configuredProvider) throw new Error("DATABASE_PROVIDER_INVALID");
  if (stored?.provider === "mysql") return { provider: "mysql" as const, locked: false, sqlitePath: configuredSqlitePath(), mysql: { host: stored.host, port: stored.port, user: stored.user, database: stored.database, ssl: stored.ssl } };
  return { provider: "sqlite" as const, locked: false, sqlitePath: stored?.provider === "sqlite" ? stored.path : configuredSqlitePath(), mysql: { host: "127.0.0.1", port: 3306, user: "", database: "", ssl: false } };
}

export function databaseConfigurationIsEnvironmentManaged() {
  return Boolean(process.env.DATABASE_PROVIDER?.trim());
}

export function captureDatabaseConfigurationFile() {
  const filePath = configFilePath();
  return { path: filePath, contents: fs.existsSync(/* turbopackIgnore: true */ filePath) ? fs.readFileSync(/* turbopackIgnore: true */ filePath) : null } satisfies DatabaseConfigurationFileSnapshot;
}

export function restoreDatabaseConfigurationFile(snapshot: DatabaseConfigurationFileSnapshot) {
  if (snapshot.contents === null) {
    fs.rmSync(snapshot.path, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(snapshot.path), { recursive: true });
  fs.writeFileSync(snapshot.path, snapshot.contents, { mode: 0o600 });
  try { fs.chmodSync(snapshot.path, 0o600); }
  catch { }
}

export function persistDatabaseConfiguration(configuration: DatabaseConfiguration) {
  if (configuration.source === "environment") return;
  const stored: StoredDatabaseConfiguration = configuration.provider === "sqlite"
    ? { version: 1, provider: "sqlite", path: configuration.path }
    : {
      version: 1,
      provider: "mysql",
      host: configuration.config.host,
      port: configuration.config.port,
      user: configuration.config.user,
      passwordCipher: encryptSecret(configuration.config.password),
      database: configuration.config.database,
      ssl: configuration.config.ssl,
    };
  const filePath = configFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
  try { fs.chmodSync(filePath, 0o600); }
  catch { }
}

export function databaseConfigurationKey(configuration: DatabaseConfiguration) {
  return configuration.provider === "sqlite"
    ? `sqlite:${configuration.path}`
    : `mysql:${configuration.config.host}:${configuration.config.port}:${configuration.config.user}:${configuration.config.database}:${configuration.config.ssl}:${configuration.config.password}`;
}
