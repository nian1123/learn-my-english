import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".ts",
  ".tsx",
]);
const sensitiveEnvironmentNames = new Set([
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
]);

function unquotedEnvironmentValue(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}

async function credentialMarkers() {
  const values = [
    "e2e-local-secret",
    "e2e-deepseek-secret",
    process.env.OPENAI_API_KEY,
    process.env.DEEPSEEK_API_KEY,
  ];
  for (const fileName of [".env.local", ".env"]) {
    const contents = await readFile(join(root, fileName), "utf8").catch(
      (error) => {
        if (error && error.code === "ENOENT") return "";
        throw error;
      },
    );
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (match && sensitiveEnvironmentNames.has(match[1])) {
        values.push(unquotedEnvironmentValue(match[2]));
      }
    }
  }
  return [...new Set(values.filter((value) => value))];
}

async function filesBelow(directory) {
  const result = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesBelow(path)));
    else if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      result.push(path);
    }
  }
  return result;
}

async function assertNoOrdinaryApplicationLogs() {
  const sourceFiles = await filesBelow(join(root, "src"));
  const offenders = [];
  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    if (/\bconsole\.(?:debug|error|info|log|warn)\s*\(/.test(source)) {
      offenders.push(relative(root, file));
    }
  }
  if (offenders.length) {
    throw new Error(`ordinary console logging found in: ${offenders.join(", ")}`);
  }
}

async function assertNoCredentialsInClientArtifacts() {
  const staticRoot = join(root, ".next", "static");
  const staticRootStats = await stat(staticRoot).catch(() => null);
  if (!staticRootStats?.isDirectory()) {
    throw new Error(".next/static is missing; run a production build first");
  }
  const clientFiles = await filesBelow(staticRoot);
  const markers = await credentialMarkers();
  for (const file of clientFiles) {
    const contents = await readFile(file, "utf8");
    const leaked = markers.some((secret) => contents.includes(secret));
    if (leaked) {
      throw new Error(`credential marker found in ${relative(root, file)}`);
    }
  }
}

async function assertNoSensitiveEnvironmentReadsInClientSource() {
  const sourceFiles = await filesBelow(join(root, "src"));
  const offenders = [];
  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    const isClientModule = /^\s*["']use client["'];/m.test(source);
    if (
      isClientModule &&
      /process\.env\.(?:OPENAI_API_KEY|DEEPSEEK_API_KEY)/.test(source)
    ) {
      offenders.push(relative(root, file));
    }
  }
  if (offenders.length) {
    throw new Error(
      `credential environment access found in client source: ${offenders.join(", ")}`,
    );
  }
}

await assertNoOrdinaryApplicationLogs();
await assertNoSensitiveEnvironmentReadsInClientSource();
await assertNoCredentialsInClientArtifacts();
process.stdout.write(
  "PASS release security: no ordinary app logs, client credential reads, or credential markers in browser assets.\n",
);
