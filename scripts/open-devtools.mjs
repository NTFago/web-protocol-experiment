import { chromium } from "playwright";
import { CONDITIONS, parseArguments } from "./lib/experiment.mjs";

const args = parseArguments(process.argv.slice(2), { condition: "h1" });
const url = args.url || CONDITIONS[args.condition]?.url;
if (!url) throw new Error("Use --condition h1|h2 or provide --url https://example.com/");

const browser = await chromium.launch({ headless: false, devtools: true });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1365, height: 768 },
  deviceScaleFactor: 1,
  serviceWorkers: "block"
});
const page = await context.newPage();
const target = new URL(url);
if (target.hostname === "127.0.0.1") target.searchParams.set("run", `manual-${Date.now()}`);
await page.goto(target.href, { waitUntil: "load", timeout: 20_000 });
process.stdout.write(`Opened ${target.href}\nClose the Chromium window when the manual capture is complete.\n`);

await new Promise((resolve) => browser.on("disconnected", resolve));

