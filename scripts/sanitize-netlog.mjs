import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, ensureArtifactDirectories } from "./lib/experiment.mjs";

await ensureArtifactDirectories();

const netlogDir = path.join(ROOT, "netlog");
const files = (await fs.readdir(netlogDir)).filter((name) => name.endsWith(".json")).sort();
const results = [];

for (const filename of files) {
  const filePath = path.join(netlogDir, filename);
  const original = await fs.readFile(filePath, "utf8");
  let replacementCount = 0;
  const sanitized = original.replace(/(x-archive-orig-set-cookie: )([^"\r\n]*)/gi, (_match, prefix, value) => {
    if (/bytes were redacted by evidence sanitizer/i.test(value)) return `${prefix}${value}`;
    replacementCount += 1;
    return `${prefix}[${Buffer.byteLength(value, "utf8")} bytes were redacted by evidence sanitizer]`;
  });
  if (replacementCount > 0) await fs.writeFile(filePath, sanitized, "utf8");
  results.push({ file: `netlog/${filename}`, replacement_count: replacementCount });
}

const reportPath = path.join(ROOT, "logs", "netlog-sanitization.json");
await fs.writeFile(
  reportPath,
  `${JSON.stringify({ generated_at: new Date().toISOString(), rule: "Redact x-archive-orig-set-cookie values only", results }, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`Saved ${reportPath}\n`);
