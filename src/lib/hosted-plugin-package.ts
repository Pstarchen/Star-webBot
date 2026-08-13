import "server-only";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { z } from "zod";

const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024;
const MAX_FILE_COUNT = 40;

const pluginConfigOptionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.union([z.string().max(200), z.number(), z.boolean()]),
});

export const pluginConfigFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  type: z.enum(["text", "textarea", "number", "boolean", "select"]),
  required: z.boolean().default(false),
  default: z.union([z.string().max(4_000), z.number(), z.boolean()]).optional(),
  placeholder: z.string().trim().max(120).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  options: z.array(pluginConfigOptionSchema).min(1).max(50).optional(),
}).superRefine((field, context) => {
  if (field.type === "select" && !field.options?.length) {
    context.addIssue({ code: "custom", message: "select 类型必须提供 options", path: ["options"] });
  }
  if (field.type !== "select" && field.options) {
    context.addIssue({ code: "custom", message: "仅 select 类型可以提供 options", path: ["options"] });
  }
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
    context.addIssue({ code: "custom", message: "min 不能大于 max", path: ["min"] });
  }
});

export const hostedPluginManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  name: z.string().trim().min(2).max(60),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  description: z.string().trim().min(10).max(500),
  author: z.string().trim().min(2).max(80),
  category: z.string().trim().min(2).max(30),
  tags: z.array(z.string().trim().min(1).max(20)).max(8).default([]),
  entry: z.string().trim().min(1).max(128),
  events: z.array(z.string().regex(/^[A-Z0-9_]{2,80}$/)).min(1).max(30),
  permissions: z.array(z.enum([
    "reply:text",
    "reply:markdown",
    "reply:ark",
    "reply:keyboard",
    "qq:api",
    "storage:kv",
    "log:write",
  ])).max(12).default([]),
  commands: z.array(z.object({
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(120),
  })).max(30).default([]),
  configSchema: z.array(pluginConfigFieldSchema).max(40).default([]),
}).superRefine((manifest, context) => {
  if (!isSafeArchivePath(manifest.entry) || !manifest.entry.endsWith(".js")) {
    context.addIssue({ code: "custom", message: "entry 必须是插件包内的安全 .js 路径", path: ["entry"] });
  }
  for (const [field, values] of [["events", manifest.events], ["permissions", manifest.permissions], ["tags", manifest.tags]] as const) {
    if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: `${field} 不能包含重复项`, path: [field] });
  }
  const configKeys = manifest.configSchema.map((field) => field.key);
  if (new Set(configKeys).size !== configKeys.length) context.addIssue({ code: "custom", message: "configSchema key 不能重复", path: ["configSchema"] });
});

export type HostedPluginManifest = z.infer<typeof hostedPluginManifestSchema>;

export type ParsedPluginPackage = {
  manifest: HostedPluginManifest;
  entryCode: string;
  readme: string | null;
  packageSha256: string;
  packageSize: number;
  validation: {
    fileCount: number;
    unpackedBytes: number;
    files: Array<{ name: string; bytes: number }>;
    scanner: "quickjs-isolated";
  };
};

function isSafeArchivePath(value: string) {
  if (!value || value.length > 180 || value.includes("\\") || value.includes("\0") || value.startsWith("/")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
}

function decodeUtf8(bytes: Uint8Array, label: string) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label}_UTF8_INVALID`);
  }
}

export function parseHostedPluginPackage(input: Uint8Array): ParsedPluginPackage {
  if (!input.length) throw new Error("PLUGIN_PACKAGE_EMPTY");
  if (input.length > MAX_PACKAGE_BYTES) throw new Error("PLUGIN_PACKAGE_TOO_LARGE");

  let fileCount = 0;
  let unpackedBytes = 0;
  let archive: ReturnType<typeof unzipSync>;
  try {
    archive = unzipSync(input, {
      filter(file) {
        if (file.name.endsWith("/")) return false;
        if (!isSafeArchivePath(file.name)) throw new Error("PLUGIN_PACKAGE_PATH_INVALID");
        fileCount += 1;
        unpackedBytes += file.originalSize;
        if (fileCount > MAX_FILE_COUNT) throw new Error("PLUGIN_PACKAGE_TOO_MANY_FILES");
        if (file.originalSize > MAX_FILE_BYTES) throw new Error("PLUGIN_PACKAGE_FILE_TOO_LARGE");
        if (unpackedBytes > MAX_UNPACKED_BYTES) throw new Error("PLUGIN_PACKAGE_UNPACKED_TOO_LARGE");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PLUGIN_")) throw error;
    throw new Error("PLUGIN_PACKAGE_INVALID");
  }

  const manifestBytes = archive["starbot.plugin.json"];
  if (!manifestBytes) throw new Error("PLUGIN_MANIFEST_MISSING");
  if (manifestBytes.length > 64 * 1024) throw new Error("PLUGIN_MANIFEST_TOO_LARGE");

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(decodeUtf8(manifestBytes, "PLUGIN_MANIFEST"));
  } catch (error) {
    if (error instanceof Error && error.message === "PLUGIN_MANIFEST_UTF8_INVALID") throw error;
    throw new Error("PLUGIN_MANIFEST_JSON_INVALID");
  }
  const parsedManifest = hostedPluginManifestSchema.safeParse(rawManifest);
  if (!parsedManifest.success) {
    const detail = parsedManifest.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`).join("; ");
    throw new Error(`PLUGIN_MANIFEST_INVALID:${detail}`);
  }

  const entryBytes = archive[parsedManifest.data.entry];
  if (!entryBytes) throw new Error("PLUGIN_ENTRY_MISSING");
  if (entryBytes.length > MAX_ENTRY_BYTES) throw new Error("PLUGIN_ENTRY_TOO_LARGE");
  const entryCode = decodeUtf8(entryBytes, "PLUGIN_ENTRY");
  if (!entryCode.trim()) throw new Error("PLUGIN_ENTRY_EMPTY");

  const readmeBytes = archive["README.md"] || archive["readme.md"];
  const files = Object.entries(archive).map(([name, bytes]) => ({ name, bytes: bytes.length })).sort((left, right) => left.name.localeCompare(right.name));
  return {
    manifest: parsedManifest.data,
    entryCode,
    readme: readmeBytes ? decodeUtf8(readmeBytes, "PLUGIN_README").slice(0, 100_000) : null,
    packageSha256: createHash("sha256").update(input).digest("hex"),
    packageSize: input.length,
    validation: { fileCount, unpackedBytes, files, scanner: "quickjs-isolated" },
  };
}

export function defaultPluginConfig(manifest: HostedPluginManifest) {
  return Object.fromEntries(manifest.configSchema.filter((field) => field.default !== undefined).map((field) => [field.key, field.default]));
}

export function validatePluginConfig(manifest: HostedPluginManifest, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("PLUGIN_CONFIG_INVALID");
  const values = input as Record<string, unknown>;
  const allowedKeys = new Set(manifest.configSchema.map((field) => field.key));
  if (Object.keys(values).some((key) => !allowedKeys.has(key))) throw new Error("PLUGIN_CONFIG_UNKNOWN_KEY");

  const output: Record<string, string | number | boolean> = {};
  for (const field of manifest.configSchema) {
    const value = values[field.key] ?? field.default;
    if (value === undefined || value === "") {
      if (field.required) throw new Error(`PLUGIN_CONFIG_REQUIRED:${field.key}`);
      continue;
    }
    if (["text", "textarea", "select"].includes(field.type)) {
      if (typeof value !== "string" || value.length > 4_000) throw new Error(`PLUGIN_CONFIG_TYPE:${field.key}`);
      if (field.type === "select" && !field.options?.some((option) => option.value === value)) throw new Error(`PLUGIN_CONFIG_OPTION:${field.key}`);
      output[field.key] = value;
      continue;
    }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`PLUGIN_CONFIG_TYPE:${field.key}`);
      if (field.min !== undefined && value < field.min) throw new Error(`PLUGIN_CONFIG_MIN:${field.key}`);
      if (field.max !== undefined && value > field.max) throw new Error(`PLUGIN_CONFIG_MAX:${field.key}`);
      output[field.key] = value;
      continue;
    }
    if (typeof value !== "boolean") throw new Error(`PLUGIN_CONFIG_TYPE:${field.key}`);
    output[field.key] = value;
  }
  return output;
}
