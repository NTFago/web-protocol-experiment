import path from "node:path";
import { chromium } from "playwright";
import {
  ROOT,
  CONDITIONS,
  ensureArtifactDirectories,
  localH3LaunchArguments,
  runSingle,
  timestampForFilename,
  writeJson
} from "./lib/experiment.mjs";

await ensureArtifactDirectories();

const stamp = timestampForFilename();
const netLogPath = path.join(ROOT, "netlog", `${stamp}-local-h3.json`);
const { launchArguments, spkiSha256 } = await localH3LaunchArguments(netLogPath);

const browser = await chromium.launch({
  headless: true,
  args: launchArguments
});

let result;
try {
  result = await runSingle(browser, {
    condition: CONDITIONS.h3,
    runId: `validate-h3-${stamp}`,
    phase: "protocol-validation",
    screenshotPath: path.join(ROOT, "screenshots", "automated", `${stamp}-local-h3.png`),
    includeRawCdpEvents: true
  });
} finally {
  await browser.close();
}

const outputPath = await writeJson(`raw/h3-local/${stamp}.json`, {
  generated_at: new Date().toISOString(),
  purpose: "local HTTP/3 protocol validation; not a performance comparison",
  endpoint: CONDITIONS.h3.url,
  browser_version: result.browser_version,
  certificate_spki_sha256: spkiSha256,
  launch_arguments: launchArguments,
  netlog: path.relative(ROOT, netLogPath),
  validation: {
    valid: result.valid,
    invalid_reason: result.invalid_reason,
    document_protocol: result.document_protocol,
    protocol_set: result.protocol_set,
    test_request_count: result.test_request_count,
    failed_request_count: result.failed_request_count,
    unique_connection_count: result.unique_connection_count
  },
  result
});

process.stdout.write(
  `h3-local: protocol=${result.document_protocol ?? "missing"}, protocols=${result.protocol_set.join(",") || "missing"}, requests=${result.test_request_count}, failed=${result.failed_request_count}, connections=${result.unique_connection_count}, valid=${result.valid}\n`
);
process.stdout.write(`Saved ${outputPath}\nSaved NetLog ${netLogPath}\n`);

if (!result.valid) process.exitCode = 2;
