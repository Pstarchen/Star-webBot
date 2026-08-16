import "server-only";
import path from "node:path";
import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from "node:worker_threads";

export type DatabaseRunResult = { changes: number; lastInsertRowid: number | bigint };

export type DatabaseStatement = {
  all: (...parameters: unknown[]) => unknown[];
  get: (...parameters: unknown[]) => unknown;
  run: (...parameters: unknown[]) => DatabaseRunResult;
};

export type PlatformDatabase = {
  prepare: (sql: string) => DatabaseStatement;
  exec: (sql: string) => void;
  pragma: (sql: string) => unknown;
  transaction: <Result>(callback: () => Result) => () => Result;
  close: () => void;
};

export type MySqlConnectionConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
};

type WorkerResponse = {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { message: string; code?: string };
};

const workerSource = String.raw`
const { workerData } = require("node:worker_threads");
const port = workerData.port;
const readySignal = new Int32Array(workerData.readySignal);

function notify(signal) {
  const view = new Int32Array(signal);
  Atomics.store(view, 0, 1);
  Atomics.notify(view, 0, 1);
}

function revive(value) {
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(revive);
  if (!value || typeof value !== "object") return value;
  for (const [key, entry] of Object.entries(value)) value[key] = revive(entry);
  return value;
}

function serializeError(error) {
  const code = error && typeof error === "object" && error.code ? String(error.code) : "";
  const original = error instanceof Error ? error.message : String(error);
  if (code === "ER_DUP_ENTRY") return { code, message: "UNIQUE constraint failed: " + original };
  if (code === "ER_CHECK_CONSTRAINT_VIOLATED") return { code, message: "CHECK constraint failed: " + original };
  return { code, message: code ? code + ": " + original : original };
}

async function runStatements(connection, sql) {
  const statements = sql.split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) {
      try {
        await connection.query(statement);
      } catch (error) {
        const code = error && typeof error === "object" ? error.code : "";
        if (code === "ER_DUP_KEYNAME" && /^CREATE\s+(?:UNIQUE\s+)?INDEX/i.test(statement)) continue;
        if (error instanceof Error) error.message = error.message + " [" + statement.replace(/\s+/g, " ").slice(0, 160) + "]";
        throw error;
      }
  }
}

(async () => {
  try {
    const { createRequire } = require("node:module");
    const mysql = createRequire(workerData.requireFrom)("mysql2/promise");
    const connection = await mysql.createConnection({
      ...workerData.config,
      connectTimeout: 5_000,
      charset: "utf8mb4_unicode_ci",
      dateStrings: true,
      decimalNumbers: true,
      supportBigNumbers: false,
      bigNumberStrings: false,
      multipleStatements: false,
    });
    port.on("message", async (message) => {
      const { id, action, sql, parameters = [], signal } = message;
      try {
        let result;
        if (action === "exec") {
          await runStatements(connection, sql);
          result = null;
        } else {
          const [rows] = await connection.execute(sql, revive(parameters));
          if (action === "run") result = { changes: Number(rows.affectedRows || 0), lastInsertRowid: rows.insertId || 0 };
          else if (action === "get") result = Array.isArray(rows) ? rows[0] : undefined;
          else result = Array.isArray(rows) ? rows : [];
        }
        port.postMessage({ id, ok: true, result });
      } catch (error) {
        port.postMessage({ id, ok: false, error: serializeError(error) });
      } finally {
        notify(signal);
      }
    });
    port.start();
    port.postMessage({ id: 0, ok: true, result: "ready" });
  } catch (error) {
    port.postMessage({ id: 0, ok: false, error: serializeError(error) });
  } finally {
    notify(workerData.readySignal);
  }
})();
`;

function normalizeMySqlSql(sql: string) {
  return sql
    .replace(/\bINSERT\s+OR\s+IGNORE\b/gi, "INSERT IGNORE")
    .replace(/\bINSERT\s+OR\s+REPLACE\b/gi, "REPLACE")
    .replace(/\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\b/gi, "ON DUPLICATE KEY UPDATE")
    .replace(/\bexcluded\.([a-z_][a-z0-9_]*)\b/gi, "VALUES($1)");
}

function revive(value: unknown): unknown {
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(revive);
  if (!value || typeof value !== "object") return value;
  for (const [key, entry] of Object.entries(value)) (value as Record<string, unknown>)[key] = revive(entry);
  return value;
}

class MySqlDatabase implements PlatformDatabase {
  private readonly worker: Worker;
  private readonly port: MessagePort;
  private requestId = 1;
  private transactionDepth = 0;
  private closed = false;

  constructor(config: MySqlConnectionConfig) {
    const channel = new MessageChannel();
    const readySignal = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    this.port = channel.port1;
    this.worker = new Worker(workerSource, {
      eval: true,
      workerData: { config, requireFrom: path.join(process.cwd(), "package.json"), port: channel.port2, readySignal },
      transferList: [channel.port2],
    });
    this.worker.unref();
    const view = new Int32Array(readySignal);
    if (Atomics.wait(view, 0, 0, 10_000) === "timed-out") {
      this.worker.terminate();
      throw new Error("MYSQL_CONNECTION_TIMEOUT");
    }
    const response = this.receive(0);
    if (!response.ok) {
      this.worker.terminate();
      throw new Error(response.error?.message || "MYSQL_CONNECTION_FAILED");
    }
  }

  prepare(sql: string): DatabaseStatement {
    const normalized = normalizeMySqlSql(sql);
    return {
      all: (...parameters) => revive(this.request("all", normalized, parameters)) as unknown[],
      get: (...parameters) => revive(this.request("get", normalized, parameters)),
      run: (...parameters) => this.request("run", normalized, parameters) as DatabaseRunResult,
    };
  }

  exec(sql: string) {
    this.request("exec", normalizeMySqlSql(sql), []);
  }

  pragma() {
    return [];
  }

  transaction<Result>(callback: () => Result) {
    return () => {
      const outermost = this.transactionDepth === 0;
      if (outermost) this.exec("START TRANSACTION");
      this.transactionDepth += 1;
      try {
        const result = callback();
        this.transactionDepth -= 1;
        if (outermost) this.exec("COMMIT");
        return result;
      } catch (error) {
        this.transactionDepth -= 1;
        if (outermost) this.exec("ROLLBACK");
        throw error;
      }
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.port.close();
    void this.worker.terminate();
  }

  private request(action: "all" | "get" | "run" | "exec", sql: string, parameters: unknown[]) {
    if (this.closed) throw new Error("MYSQL_DATABASE_CLOSED");
    const id = this.requestId;
    this.requestId += 1;
    const signal = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    this.port.postMessage({ id, action, sql, parameters, signal });
    const view = new Int32Array(signal);
    if (Atomics.wait(view, 0, 0, 60_000) === "timed-out") throw new Error("MYSQL_QUERY_TIMEOUT");
    const response = this.receive(id);
    if (!response.ok) throw new Error(response.error?.message || "MYSQL_QUERY_FAILED");
    return response.result;
  }

  private receive(id: number) {
    for (;;) {
      const message = receiveMessageOnPort(this.port)?.message as WorkerResponse | undefined;
      if (!message) throw new Error("MYSQL_WORKER_RESPONSE_MISSING");
      if (message.id === id) return message;
    }
  }
}

export function mysqlConfigFromEnvironment(): MySqlConnectionConfig {
  const database = process.env.MYSQL_DATABASE?.trim();
  const user = process.env.MYSQL_USER?.trim();
  if (!database || !user) throw new Error("MYSQL_DATABASE and MYSQL_USER are required when DATABASE_PROVIDER=mysql");
  return {
    host: process.env.MYSQL_HOST?.trim() || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user,
    password: process.env.MYSQL_PASSWORD || "",
    database,
    ssl: process.env.MYSQL_SSL === "true",
  };
}

export function createMySqlDatabase(config = mysqlConfigFromEnvironment()) {
  return new MySqlDatabase(config);
}
