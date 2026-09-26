import path from "node:path";
import { chromium } from "playwright";
import {
  ROOT,
  CONDITIONS,
  ensureArtifactDirectories,
  parseArguments,
  createSeededRandom,
  timestampForFilename,
  pad,
  runSingle,
  writeJson,
  appendNdjson
} from "./lib/experiment.mjs";

const args = parseArguments(process.argv.slice(2), {
  pairs: "30",
  warmups: "5",
  seed: String(Date.now() >>> 0)
});
const pairs = Number(args.pairs);
const warmups = Number(args.warmups);
const seed = Number(args.seed) >>> 0;

if (!Number.isInteger(pairs) || pairs < 1) throw new Error("--pairs must be a positive integer");
if (!Number.isInteger(warmups) || warmups < 0) throw new Error("--warmups must be a non-negative integer");

await ensureArtifactDirectories();
const random = createSeededRandom(seed);
const browser = await chromium.launch({ headless: true });
const schedule = [];
const measuredResults = [];
const representativeSaved = { h1: false, h2: false };

try {
  for (const conditionName of ["h1", "h2"]) {
    for (let index = 1; index <= warmups; index += 1) {
      const runId = `warmup-${conditionName}-${pad(index)}-${timestampForFilename()}`;
      const result = await runSingle(browser, {
        condition: CONDITIONS[conditionName],
        runId,
        phase: "warmup"
      });
      await writeJson(`raw/warmup/${conditionName}/${runId}.json`, result);
      await appendNdjson("logs/run-log.ndjson", {
        run_id: runId,
        phase: "warmup",
        condition: conditionName,
        valid: result.valid,
        invalid_reason: result.invalid_reason
      });
      process.stdout.write(`warmup ${conditionName} ${index}/${warmups}: ${result.valid ? "valid" : result.invalid_reason}\n`);
    }
  }

  for (let pairId = 1; pairId <= pairs; pairId += 1) {
    const order = random() < 0.5 ? ["h1", "h2"] : ["h2", "h1"];
    schedule.push({ pair_id: pairId, order });

    for (let orderIndex = 0; orderIndex < order.length; orderIndex += 1) {
      const conditionName = order[orderIndex];
      const stamp = timestampForFilename();
      const runId = `${stamp}_${conditionName}_pair${pad(pairId)}_order${orderIndex + 1}`;
      const saveRepresentative = !representativeSaved[conditionName];
      const screenshotPath = saveRepresentative
        ? path.join(ROOT, "screenshots", "automated", `${conditionName}-representative.png`)
        : null;
      const harPath = saveRepresentative
        ? path.join(ROOT, "har", `${conditionName}-representative.har`)
        : null;

      const result = await runSingle(browser, {
        condition: CONDITIONS[conditionName],
        runId,
        pairId,
        orderInPair: orderIndex + 1,
        phase: "measured",
        screenshotPath,
        harPath
      });
      representativeSaved[conditionName] = representativeSaved[conditionName]
        || (saveRepresentative && result.valid);
      await writeJson(`raw/${conditionName}/${runId}.json`, result);
      await appendNdjson("logs/run-log.ndjson", {
        run_id: runId,
        phase: "measured",
        pair_id: pairId,
        order_in_pair: orderIndex + 1,
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
        `pair ${pairId}/${pairs} order ${orderIndex + 1} ${conditionName}: ${result.valid ? "valid" : result.invalid_reason}\n`
      );
    }
  }
} finally {
  await browser.close();
}

await writeJson("logs/run-order.json", {
  generated_at: new Date().toISOString(),
  seed,
  pairs,
  warmups,
  schedule
});

const validCount = measuredResults.filter((result) => result.valid).length;
process.stdout.write(`Completed ${measuredResults.length} measured runs; ${validCount} valid. Seed: ${seed}\n`);
