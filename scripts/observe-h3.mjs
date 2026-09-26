import path from "node:path";
import { chromium } from "playwright";
import {
  ROOT,
  ensureArtifactDirectories,
  parseArguments,
  timestampForFilename,
  writeJson
} from "./lib/experiment.mjs";

const args = parseArguments(process.argv.slice(2), {
  url: "https://cloudflare-quic.com/",
  visits: "3"
});
const visits = Number(args.visits);
if (!Number.isInteger(visits) || visits < 1 || visits > 5) throw new Error("--visits must be between 1 and 5");

await ensureArtifactDirectories();
const stamp = timestampForFilename();
const mode = args["disable-quic"] ? "quic-disabled" : "default";
const netLogPath = path.join(ROOT, "netlog", `${stamp}-${mode}.json`);
const launchArgs = [
  `--log-net-log=${netLogPath}`,
  "--net-log-capture-mode=Default"
];
if (args["disable-quic"]) launchArgs.push("--disable-quic");

const browser = await chromium.launch({
  headless: !args.headed,
  args: launchArgs
});
const observations = [];
let browserVersion = browser.version();

try {
  const context = await browser.newContext({ viewport: { width: 1365, height: 768 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const responses = [];
  cdp.on("Network.responseReceived", (event) => {
    responses.push({
      visit_index: observations.length + 1,
      type: event.type,
      url: event.response.url,
      status: event.response.status,
      protocol: event.response.protocol,
      remoteIPAddress: event.response.remoteIPAddress ?? null,
      remotePort: event.response.remotePort ?? null,
      headers: event.response.headers
    });
  });

  for (let visitIndex = 1; visitIndex <= visits; visitIndex += 1) {
    const before = responses.length;
    let error = null;
    try {
      if (visitIndex === 1) {
        await page.goto(args.url, { waitUntil: "load", timeout: 30_000 });
      } else {
        await page.reload({ waitUntil: "load", timeout: 30_000 });
      }
      try {
        await page.waitForLoadState("networkidle", { timeout: 8_000 });
      } catch {
        // Public pages may keep background connections open.
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    await page.waitForTimeout(500);
    const visitResponses = responses.slice(before);
    const document = visitResponses.find((response) => response.type === "Document") ?? null;
    const altSvcKey = document
      ? Object.keys(document.headers ?? {}).find((key) => key.toLowerCase() === "alt-svc")
      : null;
    const screenshotPath = path.join(ROOT, "screenshots", "automated", `${stamp}-${mode}-visit${visitIndex}.png`);
    if (!error) await page.screenshot({ path: screenshotPath, fullPage: true });
    observations.push({
      visit_index: visitIndex,
      timestamp: new Date().toISOString(),
      document_protocol: document?.protocol ?? null,
      status: document?.status ?? null,
      alt_svc: altSvcKey ? document.headers[altSvcKey] : null,
      remote_address: document ? `${document.remoteIPAddress ?? ""}:${document.remotePort ?? ""}` : null,
      protocol_set: [...new Set(visitResponses.map((response) => response.protocol).filter(Boolean))].sort(),
      quic_disabled: Boolean(args["disable-quic"]),
      screenshot: error ? null : path.relative(ROOT, screenshotPath),
      error
    });
  }

  await context.close();
} finally {
  await browser.close();
}

const outputPath = await writeJson(`raw/h3-observation/${stamp}-${mode}.json`, {
  generated_at: new Date().toISOString(),
  url: args.url,
  mode,
  browser_version: browserVersion,
  launch_arguments: launchArgs,
  netlog: path.relative(ROOT, netLogPath),
  observations
});

for (const observation of observations) {
  process.stdout.write(
    `visit ${observation.visit_index}: protocol=${observation.document_protocol ?? "missing"}, alt-svc=${observation.alt_svc ?? "missing"}, error=${observation.error ?? "none"}\n`
  );
}
process.stdout.write(`Saved ${outputPath}\nSaved NetLog ${netLogPath}\n`);

