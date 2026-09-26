import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { ROOT } from "./lib/experiment.mjs";

const require = createRequire(import.meta.url);
const playwrightVersion = require("playwright/package.json").version;

function command(executable, args) {
  const result = spawnSync(executable, args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
  if (result.error) return `ERROR: ${result.error.message}`;
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return result.status === 0 ? output : `ERROR(${result.status}): ${output}`;
}

const packageLockPath = path.join(ROOT, "package-lock.json");
let packageLockHash = "missing";
try {
  packageLockHash = createHash("sha256").update(await readFile(packageLockPath)).digest("hex");
} catch {
  // npm install has not been run yet.
}

const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version();
await browser.close();
const npmVersion = /npm\/([^\s]+)/.exec(process.env.npm_config_user_agent ?? "")?.[1] ?? "unknown";

const lines = [
  `captured_at=${new Date().toISOString()}`,
  `timezone=${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
  `os=${os.type()} ${os.release()} ${os.arch()}`,
  `cpu=${os.cpus()[0]?.model ?? "unknown"}`,
  `logical_cpu_count=${os.cpus().length}`,
  `memory_bytes=${os.totalmem()}`,
  `node=${process.version}`,
  `npm=${npmVersion}`,
  `playwright=${playwrightVersion}`,
  `chromium=${browserVersion}`,
  `chromium_executable=${chromium.executablePath()}`,
  `package_lock_sha256=${packageLockHash}`,
  `docker_compose=${command("docker", ["compose", "version"])}`,
  `docker_info=${command("docker", ["info", "--format", "{{.ServerVersion}}|{{.OperatingSystem}}|{{.Driver}}"])}`,
  `nginx=${command("docker", ["compose", "exec", "-T", "nginx", "nginx", "-v"])}`,
  `app_node=${command("docker", ["compose", "exec", "-T", "app", "node", "--version"])}`,
  "",
  "curl:",
  command("curl.exe", ["-V"]),
  "",
  "docker_compose_images:",
  command("docker", ["compose", "images"]),
  "",
  "manual_notes:",
  "power_connected=",
  "proxy_or_vpn=",
  "https_inspection_software=",
  "docker_desktop_backend=",
  "display_scaling="
];

const outputDirectory = path.join(ROOT, "logs");
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "environment.txt");
await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
process.stdout.write(`Saved ${outputPath}\n`);
