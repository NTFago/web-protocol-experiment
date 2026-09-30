import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = "checksums-sha256.csv";
const EXCLUDED_DIRS = new Set([".git", "node_modules", "__pycache__"]);
const EXCLUDED_FILES = new Set([
  OUTPUT,
  "nginx/certs/localhost.crt",
  "nginx/certs/localhost.key"
]);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const rows = [];
for (const absolute of await listFiles(ROOT)) {
  const relative = path.relative(ROOT, absolute).replaceAll("\\", "/");
  if (EXCLUDED_FILES.has(relative)) continue;
  const data = await readFile(absolute);
  rows.push({
    path: relative,
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: (await stat(absolute)).size
  });
}

rows.sort((a, b) => a.path.localeCompare(b.path, "en"));
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const csv = [
  "path,sha256,bytes",
  ...rows.map((row) => [row.path, row.sha256, row.bytes].map(quote).join(","))
].join("\n") + "\n";

await writeFile(path.join(ROOT, OUTPUT), csv, "utf8");
process.stdout.write(`Wrote ${rows.length} checksums to ${path.join(ROOT, OUTPUT)}\n`);
