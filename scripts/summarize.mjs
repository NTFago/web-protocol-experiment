import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ROOT, ensureArtifactDirectories } from "./lib/experiment.mjs";

const RUN_COLUMNS = [
  "run_id", "timestamp", "pair_id", "order_in_pair", "condition", "valid", "invalid_reason",
  "test_request_count", "unexpected_request_count", "failed_request_count", "document_protocol",
  "protocol_set", "unique_connection_count", "nav_ttfb_ms", "dom_content_loaded_ms", "load_ms",
  "lcp_candidate_ms", "resource_completion_span_ms", "total_encoded_bytes"
];
const REQUEST_COLUMNS = [
  "run_id", "pair_id", "condition", "valid_run", "requestId", "pathname", "resourceType", "method",
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
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  };
}

async function readRuns(condition) {
  const directory = path.join(ROOT, "raw", condition);
  let names = [];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8"))));
}

await ensureArtifactDirectories();
const runs = [...await readRuns("h1"), ...await readRuns("h2")]
  .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)));

if (!runs.length) throw new Error("No measured JSON files found under raw/h1 or raw/h2");

const runRows = runs.map((run) => ({ ...run, protocol_set: run.protocol_set ?? [] }));
const requestRows = runs.flatMap((run) => run.requests
  .filter((request) => request.isTestResource)
  .map((request) => ({
    run_id: run.run_id,
    pair_id: run.pair_id,
    condition: run.condition,
    valid_run: run.valid,
    ...request
  })));

const byPair = new Map();
for (const run of runs) {
  if (!byPair.has(run.pair_id)) byPair.set(run.pair_id, {});
  byPair.get(run.pair_id)[run.condition] = run;
}

const pairedRows = [];
for (const [pairId, pair] of [...byPair.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const row = {
    pair_id: pairId,
    h1_run_id: pair.h1?.run_id ?? null,
    h2_run_id: pair.h2?.run_id ?? null,
    pair_valid: Boolean(pair.h1?.valid && pair.h2?.valid)
  };
  for (const metric of METRICS) {
    const h1 = pair.h1?.[metric];
    const h2 = pair.h2?.[metric];
    row[`h1_${metric}`] = h1 ?? null;
    row[`h2_${metric}`] = h2 ?? null;
    row[`diff_${metric}`] = row.pair_valid && Number.isFinite(h1) && Number.isFinite(h2) ? h2 - h1 : null;
    row[`relative_${metric}_pct`] = row.pair_valid && Number.isFinite(h1) && Number.isFinite(h2) && h1 !== 0
      ? ((h2 - h1) / h1) * 100
      : null;
  }
  pairedRows.push(row);
}

const summaryRows = [];
for (const condition of ["h1", "h2"]) {
  const validRuns = runs.filter((run) => run.condition === condition && run.valid);
  for (const metric of METRICS) {
    summaryRows.push({ condition, metric, ...summarize(validRuns.map((run) => run[metric])) });
  }
}
for (const metric of METRICS) {
  summaryRows.push({
    condition: "paired_h2_minus_h1",
    metric,
    ...summarize(pairedRows.map((row) => row[`diff_${metric}`]))
  });
}

const pairedColumns = [
  "pair_id", "h1_run_id", "h2_run_id", "pair_valid",
  ...METRICS.flatMap((metric) => [
    `h1_${metric}`,
    `h2_${metric}`,
    `diff_${metric}`,
    `relative_${metric}_pct`
  ])
];
const summaryColumns = ["condition", "metric", "n", "median", "q1", "q3", "min", "max", "mean"];
const outputDirectory = path.join(ROOT, "processed");
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "runs.csv"), csv(RUN_COLUMNS, runRows), "utf8");
await writeFile(path.join(outputDirectory, "requests.csv"), csv(REQUEST_COLUMNS, requestRows), "utf8");
await writeFile(path.join(outputDirectory, "paired-differences.csv"), csv(pairedColumns, pairedRows), "utf8");
await writeFile(path.join(outputDirectory, "summary.csv"), csv(summaryColumns, summaryRows), "utf8");
await writeFile(path.join(outputDirectory, "summary.json"), `${JSON.stringify({ summary: summaryRows, paired: pairedRows }, null, 2)}\n`, "utf8");

const validRuns = runs.filter((run) => run.valid).length;
const validPairs = pairedRows.filter((row) => row.pair_valid).length;
process.stdout.write(`Wrote processed data for ${runs.length} runs (${validRuns} valid) and ${validPairs} valid pairs.\n`);

