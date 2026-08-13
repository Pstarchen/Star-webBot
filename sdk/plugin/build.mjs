#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const MAX_FILE_BYTES = 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".git", "dist", ".next"]);

function walk(directory, relative = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".well-known") continue;
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolutePath, relativePath));
    else if (entry.isFile()) files.push({ relativePath, absolutePath });
  }
  return files;
}

export function buildPluginPackage(sourceDirectory, outputFile) {
  const source = path.resolve(sourceDirectory);
  const manifestPath = path.join(source, "starbot.plugin.json");
  if (!fs.existsSync(manifestPath)) throw new Error("starbot.plugin.json not found");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.entry || typeof manifest.entry !== "string") throw new Error("manifest.entry is required");
  const entryPath = path.resolve(source, manifest.entry);
  if (!entryPath.startsWith(source + path.sep) || !fs.existsSync(entryPath)) throw new Error("manifest.entry is outside the plugin directory or missing");

  const archive = {};
  for (const file of walk(source)) {
    const bytes = fs.readFileSync(file.absolutePath);
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`${file.relativePath} exceeds 1MB`);
    archive[file.relativePath.replaceAll("\\", "/")] = bytes;
  }
  const output = path.resolve(outputFile || path.join(source, "dist", `${manifest.id}-${manifest.version}.zip`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, zipSync(archive, { level: 9 }));
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = buildPluginPackage(process.argv[2] || process.cwd(), process.argv[3]);
    process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
