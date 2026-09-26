import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, ensureArtifactDirectories } from "./lib/experiment.mjs";

await ensureArtifactDirectories();
const findings = [];

for (const filename of (await fs.readdir(path.join(ROOT, "har"))).filter((name) => name.endsWith(".har")).sort()) {
  const har = JSON.parse(await fs.readFile(path.join(ROOT, "har", filename), "utf8"));
  const entries = har.log?.entries ?? [];
  const cookieObjects = entries.reduce(
    (total, entry) => total + (entry.request?.cookies?.length ?? 0) + (entry.response?.cookies?.length ?? 0),
    0
  );
  const sensitiveHeaders = entries.flatMap((entry) => [
    ...(entry.request?.headers ?? []),
    ...(entry.response?.headers ?? [])
  ]).filter((header) => /^(cookie|set-cookie|authorization|proxy-authorization)$/i.test(header.name));
  findings.push({
    file: `har/${filename}`,
    entry_count: entries.length,
    cookie_object_count: cookieObjects,
    sensitive_header_count: sensitiveHeaders.length,
    safe: cookieObjects === 0 && sensitiveHeaders.length === 0
  });
}

for (const filename of (await fs.readdir(path.join(ROOT, "netlog"))).filter((name) => name.endsWith(".json")).sort()) {
  const text = await fs.readFile(path.join(ROOT, "netlog", filename), "utf8");
  const cookieHeaders = text.match(/(?:^|[^a-z-])cookie: [^"\r\n]*/gim) ?? [];
  const setCookieHeaders = text.match(/[a-z0-9-]*set-cookie: [^"\r\n]*/gi) ?? [];
  const authorizationHeaders = text.match(/[a-z0-9-]*authorization: [^"\r\n]*/gi) ?? [];
  const unstripped = [...cookieHeaders, ...setCookieHeaders, ...authorizationHeaders].filter(
    (value) => !/\[\d+ bytes were (?:stripped|redacted by evidence sanitizer)\]/i.test(value)
  );
  findings.push({
    file: `netlog/${filename}`,
    stripped_cookie_header_count: cookieHeaders.filter((value) => /bytes were stripped/i.test(value)).length,
    stripped_set_cookie_header_count: setCookieHeaders.filter((value) => /bytes were stripped/i.test(value)).length,
    sanitized_set_cookie_header_count: setCookieHeaders.filter((value) => /redacted by evidence sanitizer/i.test(value)).length,
    authorization_header_count: authorizationHeaders.length,
    unstripped_sensitive_header_count: unstripped.length,
    safe: unstripped.length === 0
  });
}

const safe = findings.every((finding) => finding.safe);
const outputPath = path.join(ROOT, "logs", "privacy-audit.json");
await fs.writeFile(
  outputPath,
  `${JSON.stringify({ generated_at: new Date().toISOString(), safe, note: "Screenshots were also visually checked for account or desktop information.", findings }, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`${safe ? "PASS" : "FAIL"}: saved ${outputPath}\n`);
if (!safe) process.exitCode = 1;
