import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, ensureArtifactDirectories } from "./lib/experiment.mjs";

await ensureArtifactDirectories();
const netlogDirectory = path.join(ROOT, "netlog");
const filenames = (await fs.readdir(netlogDirectory)).filter((name) => name.endsWith(".json")).sort();
const summaries = [];

for (const filename of filenames) {
  const fullPath = path.join(netlogDirectory, filename);
  const netlog = JSON.parse(await fs.readFile(fullPath, "utf8"));
  const typeNames = new Map(
    Object.entries(netlog.constants?.logEventTypes ?? {}).map(([name, number]) => [Number(number), name])
  );
  const interestingCounts = new Map();
  const quicClosureEvents = [];
  for (const event of netlog.events ?? []) {
    const name = typeNames.get(Number(event.type)) ?? `UNKNOWN_${event.type}`;
    if (!/(QUIC|HTTP3|ALTERNATIVE_SERVICE|DNS_TRANSACTION|HOST_RESOLVER)/i.test(name)) continue;
    interestingCounts.set(name, (interestingCounts.get(name) ?? 0) + 1);
    if (/^QUIC_SESSION_(CLOSE_ON_ERROR|CLOSED)$/.test(name)) {
      quicClosureEvents.push({ name, source: event.source, params: event.params ?? null });
    }
  }
  summaries.push({
    file: path.relative(ROOT, fullPath),
    mode: filename.includes("quic-disabled") ? "quic-disabled" : "default",
    event_count: netlog.events?.length ?? 0,
    quic_closure_events: quicClosureEvents,
    interesting_event_counts: Object.fromEntries(
      [...interestingCounts.entries()].sort((left, right) => left[0].localeCompare(right[0]))
    )
  });
}

const outputPath = path.join(ROOT, "processed", "h3-netlog-summary.json");
await fs.writeFile(
  outputPath,
  `${JSON.stringify({ generated_at: new Date().toISOString(), summaries }, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`Saved ${outputPath}\n`);
