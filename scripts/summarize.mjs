import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ROOT, ensureArtifactDirectories } from "./lib/experiment.mjs";

const CONDITIONS = ["h1", "h2", "h3"];
const COMPARISONS = [
  { name: "h2_minus_h1", left: "h1", right: "h2" },
  { name: "h3_minus_h1", left: "h1", right: "h3" },
  { name: "h3_minus_h2", left: "h2", right: "h3" }
];
const RUN_COLUMNS = [
  "run_id", "timestamp", "block_id", "order_in_block", "condition", "valid", "invalid_reason",
  "test_request_count", "unexpected_request_count", "failed_request_count", "document_protocol",
  "protocol_set", "unique_connection_count", "nav_ttfb_ms", "dom_content_loaded_ms", "load_ms",
  "lcp_candidate_ms", "resource_completion_span_ms", "total_encoded_bytes"
];
const REQUEST_COLUMNS = [
  "run_id", "block_id", "condition", "valid_run", "requestId", "pathname", "resourceType", "method",
  "status", "mimeType", "protocol", "connectionId", "connectionReused", "remoteIPAddress", "remotePort",
  "fromDiskCache", "fromServiceWorker", "requestTime", "sendStart", "sendEnd", "receiveHeadersStart",
  "receiveHeadersEnd", "loadingFinishedTimestamp", "encodedDataLength", "performanceStartTime",
  "performanceResponseStart", "performanceResponseEnd", "performanceTtfbMs", "errorText"
];
const METRICS = [
  "nav_ttfb_ms",
  "dom_content_loaded_ms",
  "load_ms",
  "lcp_candidate_ms",
  "resource_completion_span_ms",
  "unique_connection_count",
  "total_encoded_bytes"
];

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("|") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(columns, rows) {
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
}

function quantile(sorted, probability) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return { n: 0, median: null, q1: null, q3: null, min: null, max: null, mean: null };
  return {
    n: sorted.length,
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    min: sorted[0],
    max: sorted.at(-1),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  };
}

const manifest = JSON.parse(await readFile(path.join(ROOT, "logs", "tri-protocol-run-order.json"), "utf8"));
const rawRoot = path.join(ROOT, ...manifest.raw_root.split("/"));

async function readRuns(condition) {
  const directory = path.join(rawRoot, condition);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8"))));
}

await ensureArtifactDirectories();
const runs = (await Promise.all(CONDITIONS.map(readRuns)))
  .flat()
  .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)));

if (!runs.length) throw new Error(`No measured JSON files found under ${manifest.raw_root}`);

const runRows = runs.map((run) => ({ ...run, protocol_set: run.protocol_set ?? [] }));
const requestRows = runs.flatMap((run) => run.requests
  .filter((request) => request.isTestResource)
  .map((request) => ({
    run_id: run.run_id,
    block_id: run.block_id,
    condition: run.condition,
    valid_run: run.valid,
    ...request
  })));

const byBlock = new Map();
for (const run of runs) {
  if (!byBlock.has(run.block_id)) byBlock.set(run.block_id, {});
  byBlock.get(run.block_id)[run.condition] = run;
}

const blockRows = [];
for (const [blockId, block] of [...byBlock.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const blockValid = CONDITIONS.every((condition) => block[condition]?.valid);
  const row = { block_id: blockId, block_valid: blockValid };
  for (const condition of CONDITIONS) row[`${condition}_run_id`] = block[condition]?.run_id ?? null;
  for (const metric of METRICS) {
    for (const condition of CONDITIONS) row[`${condition}_${metric}`] = block[condition]?.[metric] ?? null;
    for (const comparison of COMPARISONS) {
      const left = block[comparison.left]?.[metric];
      const right = block[comparison.right]?.[metric];
      row[`diff_${comparison.name}_${metric}`] = blockValid && Number.isFinite(left) && Number.isFinite(right)
        ? right - left
        : null;
      row[`relative_${comparison.name}_${metric}_pct`] = blockValid && Number.isFinite(left) && Number.isFinite(right) && left !== 0
        ? ((right - left) / left) * 100
        : null;
    }
  }
  blockRows.push(row);
}

const summaryRows = [];
for (const condition of CONDITIONS) {
  const validRuns = runs.filter((run) => run.condition === condition && run.valid);
  for (const metric of METRICS) {
    summaryRows.push({ condition, metric, ...summarize(validRuns.map((run) => run[metric])) });
  }
}
for (const comparison of COMPARISONS) {
  for (const metric of METRICS) {
    summaryRows.push({
      condition: comparison.name,
      metric,
      ...summarize(blockRows.map((row) => row[`diff_${comparison.name}_${metric}`]))
    });
    summaryRows.push({
      condition: `${comparison.name}_relative_pct`,
      metric,
      ...summarize(blockRows.map((row) => row[`relative_${comparison.name}_${metric}_pct`]))
    });
  }
}

const blockColumns = [
  "block_id", "block_valid", ...CONDITIONS.map((condition) => `${condition}_run_id`),
  ...METRICS.flatMap((metric) => [
    ...CONDITIONS.map((condition) => `${condition}_${metric}`),
    ...COMPARISONS.flatMap((comparison) => [
      `diff_${comparison.name}_${metric}`,
      `relative_${comparison.name}_${metric}_pct`
    ])
  ])
];
const summaryColumns = ["condition", "metric", "n", "median", "q1", "q3", "min", "max", "mean"];
const outputDirectory = path.join(ROOT, "processed");
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "runs.csv"), csv(RUN_COLUMNS, runRows), "utf8");
await writeFile(path.join(outputDirectory, "requests.csv"), csv(REQUEST_COLUMNS, requestRows), "utf8");
await writeFile(path.join(outputDirectory, "block-differences.csv"), csv(blockColumns, blockRows), "utf8");
await writeFile(path.join(outputDirectory, "summary.csv"), csv(summaryColumns, summaryRows), "utf8");
await writeFile(
  path.join(outputDirectory, "summary.json"),
  `${JSON.stringify({ campaign: manifest, summary: summaryRows, blocks: blockRows, comparisons: COMPARISONS }, null, 2)}\n`,
  "utf8"
);

const validRuns = runs.filter((run) => run.valid).length;
const validBlocks = blockRows.filter((row) => row.block_valid).length;
process.stdout.write(
  `Wrote processed data for campaign ${manifest.campaign_id}: ${runs.length} runs (${validRuns} valid) and ${validBlocks} valid blocks.\n`
);
