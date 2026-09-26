import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, ensureArtifactDirectories } from "./lib/experiment.mjs";

await ensureArtifactDirectories();

async function loadMeasuredRuns(condition) {
  const directory = path.join(ROOT, "raw", condition);
  const filenames = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(filenames.map(async (filename) => JSON.parse(await fs.readFile(path.join(directory, filename), "utf8"))));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const measuredRuns = [...(await loadMeasuredRuns("h1")), ...(await loadMeasuredRuns("h2"))];
const runMetadata = new Map(measuredRuns.map((run) => [run.run_id, run]));
const aggregates = new Map(
  measuredRuns.map((run) => [
    run.run_id,
    {
      run_id: run.run_id,
      condition: run.condition,
      pair_id: run.pair_id,
      svg_request_count: 0,
      max_active_svg_requests: 0,
      reported_peak_active_svg_requests: 0,
      upstream_sockets: new Set()
    }
  ])
);

const composeLog = await fs.readFile(path.join(ROOT, "logs", "compose-logs.txt"), "utf8");
for (const line of composeLog.split(/\r?\n/)) {
  const jsonStart = line.indexOf("{");
  if (jsonStart < 0) continue;
  let entry;
  try {
    entry = JSON.parse(line.slice(jsonStart));
  } catch {
    continue;
  }
  if (entry.event !== "svg_delay_start" || !runMetadata.has(entry.run_id)) continue;
  const aggregate = aggregates.get(entry.run_id);
  aggregate.svg_request_count += 1;
  aggregate.max_active_svg_requests = Math.max(aggregate.max_active_svg_requests, Number(entry.active_svg_requests));
  aggregate.reported_peak_active_svg_requests = Math.max(
    aggregate.reported_peak_active_svg_requests,
    Number(entry.peak_active_svg_requests)
  );
  if (entry.upstream_socket) aggregate.upstream_sockets.add(entry.upstream_socket);
}

const runs = [...aggregates.values()]
  .map((run) => ({ ...run, unique_upstream_socket_count: run.upstream_sockets.size, upstream_sockets: [...run.upstream_sockets].sort() }))
  .sort((left, right) => left.condition.localeCompare(right.condition) || left.pair_id - right.pair_id);

const byCondition = {};
for (const condition of ["h1", "h2"]) {
  const selected = runs.filter((run) => run.condition === condition);
  const concurrency = selected.map((run) => run.max_active_svg_requests);
  const socketCounts = selected.map((run) => run.unique_upstream_socket_count);
  byCondition[condition] = {
    n: selected.length,
    svg_request_counts: [...new Set(selected.map((run) => run.svg_request_count))].sort((a, b) => a - b),
    max_active_svg_requests: { min: Math.min(...concurrency), median: median(concurrency), max: Math.max(...concurrency) },
    unique_upstream_socket_count: { min: Math.min(...socketCounts), median: median(socketCounts), max: Math.max(...socketCounts) }
  };
}

const outputPath = path.join(ROOT, "processed", "server-concurrency-summary.json");
await fs.writeFile(
  outputPath,
  `${JSON.stringify({ generated_at: new Date().toISOString(), by_condition: byCondition, runs }, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`Saved ${outputPath}\n`);
