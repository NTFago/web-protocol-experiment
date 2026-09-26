import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./lib/experiment.mjs";

let invalid = 0;
let total = 0;
const reasons = new Map();

for (const condition of ["h1", "h2"]) {
  const directory = path.join(ROOT, "raw", condition);
  let names = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let validForCondition = 0;
  for (const name of names) {
    const run = JSON.parse(await readFile(path.join(directory, name), "utf8"));
    total += 1;
    if (run.valid) {
      validForCondition += 1;
    } else {
      invalid += 1;
      const reason = run.invalid_reason ?? "unknown";
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }
  process.stdout.write(`${condition}: ${names.length} runs, ${validForCondition} valid\n`);
}

if (!total) {
  process.stderr.write("No measured runs found.\n");
  process.exitCode = 2;
} else if (invalid) {
  process.stderr.write(`${invalid}/${total} runs are invalid:\n`);
  for (const [reason, count] of reasons) process.stderr.write(`  ${count} x ${reason}\n`);
  process.exitCode = 2;
} else {
  process.stdout.write(`All ${total} measured runs passed the declared validity checks.\n`);
}

