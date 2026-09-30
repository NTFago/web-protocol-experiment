import path from "node:path";
import { chromium } from "playwright";
import {
  ROOT,
  CONDITIONS,
  appendNdjson,
  createSeededRandom,
  ensureArtifactDirectories,
  localH3LaunchArguments,
  pad,
  parseArguments,
  runSingle,
  timestampForFilename,
  writeJson
} from "./lib/experiment.mjs";

const args = parseArguments(process.argv.slice(2), {
  blocks: "30",
  warmups: "5",
  seed: String(Date.now() >>> 0)
});
const blocks = Number(args.blocks);
const warmups = Number(args.warmups);
const seed = Number(args.seed) >>> 0;

if (!Number.isInteger(blocks) || blocks < 1) throw new Error("--blocks must be a positive integer");
if (!Number.isInteger(warmups) || warmups < 0) throw new Error("--warmups must be a non-negative integer");

const conditions = ["h1", "h2", "h3"];
const permutations = [
  ["h1", "h2", "h3"],
  ["h1", "h3", "h2"],
  ["h2", "h1", "h3"],
  ["h2", "h3", "h1"],
  ["h3", "h1", "h2"],
  ["h3", "h2", "h1"]
];

function balancedSchedule(count, random) {
  const schedule = Array.from({ length: count }, (_, index) => [...permutations[index % permutations.length]]);
  for (let index = schedule.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [schedule[index], schedule[swapIndex]] = [schedule[swapIndex], schedule[index]];
  }
  return schedule;
}

await ensureArtifactDirectories();
const campaignId = `tri-${timestampForFilename()}`;
const rawRoot = `raw/tri-protocol/${campaignId}`;
const runLog = `logs/${campaignId}-run-log.ndjson`;
const netLogPath = path.join(ROOT, "netlog", `${campaignId}.json`);
const { launchArguments, spkiSha256 } = await localH3LaunchArguments(netLogPath);
const random = createSeededRandom(seed);
const orders = balancedSchedule(blocks, random);
const browser = await chromium.launch({ headless: true, args: launchArguments });
const measuredResults = [];
const representativeSaved = { h1: false, h2: false, h3: false };

try {
  for (const conditionName of conditions) {
    for (let index = 1; index <= warmups; index += 1) {
      const runId = `${campaignId}_warmup_${conditionName}_${pad(index)}`;
      const result = await runSingle(browser, {
        condition: CONDITIONS[conditionName],
        runId,
        phase: "warmup"
      });
      await writeJson(`${rawRoot}/warmup/${conditionName}/${runId}.json`, result);
      await appendNdjson(runLog, {
        campaign_id: campaignId,
        run_id: runId,
        phase: "warmup",
        condition: conditionName,
        valid: result.valid,
        invalid_reason: result.invalid_reason
      });
      process.stdout.write(`warmup ${conditionName} ${index}/${warmups}: ${result.valid ? "valid" : result.invalid_reason}\n`);
    }
  }

  for (let blockId = 1; blockId <= blocks; blockId += 1) {
    const order = orders[blockId - 1];
    for (let orderIndex = 0; orderIndex < order.length; orderIndex += 1) {
      const conditionName = order[orderIndex];
      const runId = `${campaignId}_${conditionName}_block${pad(blockId)}_order${orderIndex + 1}`;
      const saveRepresentative = !representativeSaved[conditionName];
      const screenshotPath = saveRepresentative
        ? path.join(ROOT, "screenshots", "automated", `${campaignId}-${conditionName}-representative.png`)
        : null;
      const harPath = saveRepresentative
        ? path.join(ROOT, "har", `${campaignId}-${conditionName}-representative.har`)
        : null;

      const result = await runSingle(browser, {
        condition: CONDITIONS[conditionName],
        runId,
        blockId,
        orderInBlock: orderIndex + 1,
        phase: "measured",
        screenshotPath,
        harPath
      });
      representativeSaved[conditionName] = representativeSaved[conditionName]
        || (saveRepresentative && result.valid);
      await writeJson(`${rawRoot}/${conditionName}/${runId}.json`, result);
      await appendNdjson(runLog, {
        campaign_id: campaignId,
        run_id: runId,
        phase: "measured",
        block_id: blockId,
        order_in_block: orderIndex + 1,
        condition: conditionName,
        valid: result.valid,
        invalid_reason: result.invalid_reason,
        test_request_count: result.test_request_count,
        protocol_set: result.protocol_set,
        unique_connection_count: result.unique_connection_count,
        load_ms: result.load_ms
      });
      measuredResults.push(result);
      process.stdout.write(
        `block ${blockId}/${blocks} order ${orderIndex + 1} ${conditionName}: ${result.valid ? "valid" : result.invalid_reason}\n`
      );
    }
  }
} finally {
  await browser.close();
}

const schedule = orders.map((order, index) => ({ block_id: index + 1, order }));
await writeJson("logs/tri-protocol-run-order.json", {
  generated_at: new Date().toISOString(),
  campaign_id: campaignId,
  raw_root: rawRoot,
  run_log: runLog,
  netlog: path.relative(ROOT, netLogPath),
  seed,
  blocks,
  warmups_per_condition: warmups,
  condition_names: conditions,
  schedule,
  permutation_counts: Object.fromEntries(
    permutations.map((permutation) => {
      const key = permutation.join(">");
      return [key, schedule.filter((entry) => entry.order.join(">") === key).length];
    })
  ),
  browser_launch_arguments: launchArguments,
  certificate_spki_sha256: spkiSha256
});

const validCount = measuredResults.filter((result) => result.valid).length;
process.stdout.write(
  `Completed campaign ${campaignId}: ${measuredResults.length} measured runs; ${validCount} valid. Seed: ${seed}\n`
);

if (validCount !== measuredResults.length) process.exitCode = 2;
