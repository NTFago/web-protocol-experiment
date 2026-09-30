import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./lib/experiment.mjs";

function run(args) {
  const result = spawnSync("docker", args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} failed (${result.status}): ${output}`);
  return output;
}

const outputDirectory = path.join(ROOT, "logs");
await mkdir(outputDirectory, { recursive: true });

const composeLogs = run(["compose", "logs", "--no-color"]);
const nginxConfig = run(["compose", "exec", "-T", "nginx", "nginx", "-T"]);
const composePs = run(["compose", "ps"]);

await writeFile(path.join(outputDirectory, "tri-protocol-compose-logs.txt"), composeLogs, "utf8");
await writeFile(path.join(outputDirectory, "tri-protocol-nginx-config.txt"), nginxConfig, "utf8");
await writeFile(path.join(outputDirectory, "tri-protocol-compose-ps.txt"), composePs, "utf8");

process.stdout.write(`Saved tri-protocol Compose logs, Nginx configuration, and service status to ${outputDirectory}\n`);
