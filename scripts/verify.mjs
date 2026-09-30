import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, EXPECTED_SVG_REQUESTS, EXPECTED_TEST_REQUESTS } from "./lib/experiment.mjs";

const CONDITIONS = ["h1", "h2", "h3"];
const EXPECTED_PROTOCOLS = { h1: "http/1.1", h2: "h2", h3: "h3" };
const manifest = JSON.parse(await readFile(path.join(ROOT, "logs", "tri-protocol-run-order.json"), "utf8"));
const rawRoot = path.join(ROOT, ...manifest.raw_root.split("/"));
const runs = [];
const failures = [];

for (const condition of CONDITIONS) {
  const directory = path.join(rawRoot, condition);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  let validForCondition = 0;
  for (const name of names) {
    const run = JSON.parse(await readFile(path.join(directory, name), "utf8"));
    runs.push(run);
    const svgCount = run.requests.filter((request) => request.isSvg).length;
    const protocolMatches = run.document_protocol === EXPECTED_PROTOCOLS[condition]
      && run.protocol_set.length === 1
      && run.protocol_set[0] === EXPECTED_PROTOCOLS[condition];
    const valid = run.valid
      && run.test_request_count === EXPECTED_TEST_REQUESTS
      && svgCount === EXPECTED_SVG_REQUESTS
      && run.failed_request_count === 0
      && protocolMatches;
    if (valid) {
      validForCondition += 1;
    } else {
      failures.push({
        run_id: run.run_id,
        condition,
        declared_valid: run.valid,
        invalid_reason: run.invalid_reason,
        test_request_count: run.test_request_count,
        svg_request_count: svgCount,
        failed_request_count: run.failed_request_count,
        document_protocol: run.document_protocol,
        protocol_set: run.protocol_set
      });
    }
  }
  process.stdout.write(`${condition}: ${names.length} runs, ${validForCondition} valid\n`);
}

const byBlock = new Map();
for (const run of runs) {
  if (!byBlock.has(run.block_id)) byBlock.set(run.block_id, []);
  byBlock.get(run.block_id).push(run);
}
for (const [blockId, blockRuns] of byBlock) {
  const conditionSet = new Set(blockRuns.map((run) => run.condition));
  const orderSet = new Set(blockRuns.map((run) => run.order_in_block));
  if (blockRuns.length !== CONDITIONS.length || conditionSet.size !== CONDITIONS.length || orderSet.size !== CONDITIONS.length) {
    failures.push({ block_id: blockId, reason: "incomplete_or_duplicate_block" });
  }
}

if (runs.length !== manifest.blocks * CONDITIONS.length) {
  failures.push({
    reason: "unexpected_measured_run_count",
    expected: manifest.blocks * CONDITIONS.length,
    actual: runs.length
  });
}
if (byBlock.size !== manifest.blocks) {
  failures.push({ reason: "unexpected_block_count", expected: manifest.blocks, actual: byBlock.size });
}

if (failures.length) {
  process.stderr.write(`${failures.length} validation failure(s):\n${JSON.stringify(failures, null, 2)}\n`);
  process.exitCode = 2;
} else {
  process.stdout.write(
    `All ${runs.length} measured runs in ${byBlock.size} blocks passed request, protocol, and completeness checks.\n`
  );
}
