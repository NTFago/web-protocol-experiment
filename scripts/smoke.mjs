import path from "node:path";
import { chromium } from "playwright";
import {
  ROOT,
  CONDITIONS,
  ensureArtifactDirectories,
  localH3LaunchArguments,
  timestampForFilename,
  runSingle,
  writeJson
} from "./lib/experiment.mjs";

await ensureArtifactDirectories();
const { launchArguments } = await localH3LaunchArguments();
const browser = await chromium.launch({ headless: true, args: launchArguments });
const results = [];

try {
  for (const conditionName of ["h1", "h2", "h3"]) {
    const runId = `smoke-${conditionName}-${timestampForFilename()}`;
    const result = await runSingle(browser, {
      condition: CONDITIONS[conditionName],
      runId,
      phase: "smoke",
      screenshotPath: path.join(ROOT, "screenshots", "automated", `smoke-${conditionName}.png`),
      includeRawCdpEvents: true
    });
    results.push(result);
    process.stdout.write(
      `${conditionName}: protocol=${result.document_protocol}, requests=${result.test_request_count}, connections=${result.unique_connection_count}, valid=${result.valid}\n`
    );
  }
} finally {
  await browser.close();
}

const outputPath = await writeJson("logs/cdp-smoke.json", {
  generated_at: new Date().toISOString(),
  results
});
process.stdout.write(`Saved ${outputPath}\n`);

if (results.some((result) => !result.valid)) process.exitCode = 2;

