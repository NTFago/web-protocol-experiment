import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./lib/experiment.mjs";

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;"
  })[character]);
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

function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    values: sorted,
    min: sorted[0],
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted.at(-1)
  };
}

function formatNumber(value) {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function boxPlotSvg(title, unit, groups) {
  const width = 900;
  const height = 520;
  const margin = { top: 64, right: 54, bottom: 76, left: 92 };
  const allValues = groups.flatMap((group) => group.values).filter(Number.isFinite);
  if (!allValues.length) throw new Error(`No values for ${title}`);
  let minimum = Math.min(...allValues);
  let maximum = Math.max(...allValues);
  const pad = (maximum - minimum || Math.max(Math.abs(maximum), 1)) * 0.1;
  minimum -= pad;
  maximum += pad;
  const plotHeight = height - margin.top - margin.bottom;
  const y = (value) => margin.top + ((maximum - value) / (maximum - minimum)) * plotHeight;
  const groupWidth = (width - margin.left - margin.right) / groups.length;
  const colors = ["#496f96", "#c06a42", "#3c8d6d"];
  const elements = [];

  elements.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  elements.push(`<text x="${margin.left}" y="34" font-size="22" font-weight="700" fill="#18212b">${escapeXml(title)}</text>`);
  for (let tick = 0; tick <= 5; tick += 1) {
    const value = minimum + ((maximum - minimum) * tick) / 5;
    const position = y(value);
    elements.push(`<line x1="${margin.left}" y1="${position}" x2="${width - margin.right}" y2="${position}" stroke="#e4e8ec"/>`);
    elements.push(`<text x="${margin.left - 12}" y="${position + 4}" text-anchor="end" font-size="12" fill="#596b7d">${escapeXml(formatNumber(value))}</text>`);
  }
  elements.push(`<text transform="translate(24 ${height / 2}) rotate(-90)" text-anchor="middle" font-size="13" fill="#526579">${escapeXml(unit)}</text>`);

  groups.forEach((group, index) => {
    const groupStats = stats(group.values);
    const center = margin.left + groupWidth * (index + 0.5);
    const color = colors[index % colors.length];
    const boxWidth = Math.min(120, groupWidth * 0.35);
    elements.push(`<line x1="${center}" y1="${y(groupStats.max)}" x2="${center}" y2="${y(groupStats.min)}" stroke="${color}" stroke-width="2"/>`);
    elements.push(`<line x1="${center - boxWidth / 3}" y1="${y(groupStats.max)}" x2="${center + boxWidth / 3}" y2="${y(groupStats.max)}" stroke="${color}" stroke-width="2"/>`);
    elements.push(`<line x1="${center - boxWidth / 3}" y1="${y(groupStats.min)}" x2="${center + boxWidth / 3}" y2="${y(groupStats.min)}" stroke="${color}" stroke-width="2"/>`);
    elements.push(`<rect x="${center - boxWidth / 2}" y="${y(groupStats.q3)}" width="${boxWidth}" height="${Math.max(1, y(groupStats.q1) - y(groupStats.q3))}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="2"/>`);
    elements.push(`<line x1="${center - boxWidth / 2}" y1="${y(groupStats.median)}" x2="${center + boxWidth / 2}" y2="${y(groupStats.median)}" stroke="${color}" stroke-width="3"/>`);
    groupStats.values.forEach((value, pointIndex) => {
      const jitter = (((pointIndex * 37) % 23) - 11) * 2.2;
      elements.push(`<circle cx="${center + jitter}" cy="${y(value)}" r="3.2" fill="${color}" fill-opacity="0.65"/>`);
    });
    elements.push(`<text x="${center}" y="${height - 42}" text-anchor="middle" font-size="15" font-weight="700" fill="#263645">${escapeXml(group.label)}</text>`);
    elements.push(`<text x="${center}" y="${height - 22}" text-anchor="middle" font-size="12" fill="#6a7784">n=${groupStats.values.length}, median=${escapeXml(formatNumber(groupStats.median))}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}"><g font-family="Arial, 'Microsoft YaHei', sans-serif">${elements.join("")}</g></svg>\n`;
}

function pairedDifferenceSvg(title, metric, pairs) {
  const values = pairs.map((pair) => pair[`diff_${metric}`]).filter(Number.isFinite);
  if (!values.length) throw new Error(`No paired values for ${metric}`);
  const width = 980;
  const height = 500;
  const margin = { top: 62, right: 48, bottom: 70, left: 92 };
  let minimum = Math.min(0, ...values);
  let maximum = Math.max(0, ...values);
  const pad = (maximum - minimum || 1) * 0.12;
  minimum -= pad;
  maximum += pad;
  const x = (index) => margin.left + (index / Math.max(values.length - 1, 1)) * (width - margin.left - margin.right);
  const y = (value) => margin.top + ((maximum - value) / (maximum - minimum)) * (height - margin.top - margin.bottom);
  const elements = [`<rect width="${width}" height="${height}" fill="#ffffff"/>`];
  elements.push(`<text x="${margin.left}" y="34" font-size="22" font-weight="700" fill="#18212b">${escapeXml(title)}</text>`);
  elements.push(`<line x1="${margin.left}" y1="${y(0)}" x2="${width - margin.right}" y2="${y(0)}" stroke="#5b6570" stroke-dasharray="6 5"/>`);
  values.forEach((value, index) => {
    const color = value <= 0 ? "#496f96" : "#c06a42";
    elements.push(`<line x1="${x(index)}" y1="${y(0)}" x2="${x(index)}" y2="${y(value)}" stroke="${color}" stroke-width="2"/>`);
    elements.push(`<circle cx="${x(index)}" cy="${y(value)}" r="4" fill="${color}"/>`);
  });
  elements.push(`<text x="24" y="${height / 2}" transform="rotate(-90 24 ${height / 2})" text-anchor="middle" font-size="13" fill="#526579">H2 - H1 (ms)</text>`);
  elements.push(`<text x="${width / 2}" y="${height - 24}" text-anchor="middle" font-size="13" fill="#526579">paired round</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}"><g font-family="Arial, 'Microsoft YaHei', sans-serif">${elements.join("")}</g></svg>\n`;
}

const raw = JSON.parse(await readFile(path.join(ROOT, "processed", "summary.json"), "utf8"));
const runs = [];
const conditions = ["h1", "h2", "h3"];
const rawRoot = path.join(ROOT, ...raw.campaign.raw_root.split("/"));
for (const condition of conditions) {
  const directory = path.join(rawRoot, condition);
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  for (const name of names) runs.push(JSON.parse(await readFile(path.join(directory, name), "utf8")));
}
const validRuns = runs.filter((run) => run.valid);
const outputDirectory = path.join(ROOT, "figures");
await mkdir(outputDirectory, { recursive: true });

const charts = [
  ["load-distribution.svg", "Page load event", "milliseconds", "load_ms"],
  ["resource-span-distribution.svg", "SVG resource completion span", "milliseconds", "resource_completion_span_ms"],
  ["lcp-distribution.svg", "LCP candidate snapshot", "milliseconds", "lcp_candidate_ms"],
  ["connection-count.svg", "Unique browser connection count", "connections", "unique_connection_count"]
];

for (const [filename, title, unit, metric] of charts) {
  const groups = conditions.map((condition) => ({
    label: ({ h1: "HTTP/1.1", h2: "HTTP/2", h3: "HTTP/3" })[condition],
    values: validRuns.filter((run) => run.condition === condition).map((run) => run[metric]).filter(Number.isFinite)
  }));
  if (groups.every((group) => group.values.length)) {
    await writeFile(path.join(outputDirectory, filename), boxPlotSvg(title, unit, groups), "utf8");
  }
}

process.stdout.write(`Wrote SVG figures to ${outputDirectory}\n`);

