import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT, ensureArtifactDirectories, parseArguments } from "./lib/experiment.mjs";

const CASES = [
  {
    id: "h1",
    url: "https://127.0.0.1:8441/",
    resourcePattern: "01.svg",
    networkFile: "m1-h1-network.png",
    headersFile: "m2-h1-headers.png"
  },
  {
    id: "h2",
    url: "https://127.0.0.1:8442/",
    resourcePattern: "01.svg",
    networkFile: "m3-h2-network.png",
    headersFile: "m4-h2-headers.png"
  },
  {
    id: "public",
    url: "https://www.wikipedia.org/",
    resourcePattern: "wikipedia",
    networkFile: "m6-public-network.png",
    headersFile: "m7-public-headers.png"
  },
  {
    id: "h3-default",
    url: "https://cloudflare-quic.com/",
    resourcePattern: "cloudflare-quic.com",
    networkFile: "h3-default-visit1-network.png",
    additionalNetworkFiles: ["h3-default-visit2-network.png", "h3-default-visit3-network.png"],
    headersFile: "h3-default-headers.png"
  },
  {
    id: "h3-disabled",
    url: "https://cloudflare-quic.com/",
    resourcePattern: "cloudflare-quic.com",
    networkFile: "h3-disabled-network.png",
    headersFile: "h3-disabled-headers.png",
    disableQuic: true
  }
];

const args = parseArguments(process.argv.slice(2), {});
const selectedCases = args.case ? CASES.filter((item) => item.id === args.case) : CASES;
if (!selectedCases.length) throw new Error("--case must be h1, h2, public, h3-default, or h3-disabled");

const outputDirectory = path.join(ROOT, "screenshots", "manual-devtools");
const chromeLogDirectory = path.join(ROOT, "logs", "devtools-capture");

await ensureArtifactDirectories();
await fs.mkdir(outputDirectory, { recursive: true });
await fs.mkdir(chromeLogDirectory, { recursive: true });

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForJsonList(port, timeoutMilliseconds = 20_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await wait(200);
  }
  throw new Error(`Chrome remote debugging endpoint did not start: ${lastError ?? "timeout"}`);
}

async function waitForInspectedTarget(port, expectedUrl, timeoutMilliseconds = 20_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const targets = await waitForJsonList(port, 2_000);
    const target = targets.find((item) => item.type === "page" && item.url.startsWith(expectedUrl));
    if (target) return target;
    await wait(200);
  }
  throw new Error(`Could not find inspected target for ${expectedUrl}`);
}

async function dismissLanguageBanner(devtoolsPage) {
  const banner = devtoolsPage.locator('[aria-label="DevTools is now available in Chinese"]').filter({ visible: true });
  if (await banner.count()) {
    const close = banner.last().getByRole("button", { name: "Close" });
    if (await close.count()) await close.last().click({ force: true });
    await devtoolsPage.waitForTimeout(250);
  }
}

async function hideTargetScreencast(devtoolsPage) {
  const toggle = devtoolsPage.locator('[aria-label="Toggle screencast"]').filter({ visible: true });
  if (await toggle.count()) {
    await toggle.last().click({ force: true });
    await devtoolsPage.waitForTimeout(750);
  }
}

async function openNetworkPanel(devtoolsPage) {
  const networkTab = devtoolsPage.getByText("Network", { exact: true });
  if (!(await networkTab.first().isVisible())) {
    const moreTabs = devtoolsPage.locator('[aria-label*="More tabs"], [title*="More tabs"]');
    const visibleMoreTabs = moreTabs.filter({ visible: true });
    if (await visibleMoreTabs.count()) {
      await visibleMoreTabs.last().click();
      await devtoolsPage.waitForTimeout(250);
    }
  }
  const visibleNetworkTab = networkTab.filter({ visible: true });
  await visibleNetworkTab.first().waitFor({ state: "visible", timeout: 20_000 });
  await visibleNetworkTab.first().click({ force: true });
  await devtoolsPage.waitForTimeout(500);
}

async function enableDisableCache(devtoolsPage) {
  const label = devtoolsPage.getByText("Disable cache", { exact: true }).filter({ visible: true });
  if (args.debug) {
    const checkboxes = await devtoolsPage.locator('input[type="checkbox"], [role="checkbox"], devtools-checkbox').evaluateAll((elements) =>
      elements.map((element) => ({
        checked: element.checked,
        aria: element.getAttribute("aria-label"),
        outer: element.outerHTML,
        parentText: element.parentElement?.textContent?.trim()
      }))
    );
    process.stdout.write(`Network checkboxes: ${JSON.stringify(checkboxes)}\n`);
  }
  if (args.debug && (await label.count())) {
    process.stdout.write(`Disable cache markup: ${await label.last().evaluate((element) => element.outerHTML)}\n`);
  }
  if (await label.count()) {
    const candidate = label.last();
    const checkbox = candidate.locator('xpath=preceding-sibling::input[@type="checkbox"][1]');
    if (await checkbox.count()) await checkbox.check({ force: true });
    else await candidate.click({ force: true });
  }
  if (!(await label.count())) await devtoolsPage.mouse.click(232, 40);
}

async function enableNetworkColumn(devtoolsPage, columnName) {
  const nameHeader = devtoolsPage.getByText("Name", { exact: true }).filter({ visible: true });
  if (!(await nameHeader.count())) return false;
  await nameHeader.last().click({ button: "right", force: true });
  await devtoolsPage.waitForTimeout(200);
  if (args.debug) {
    const menuItems = await devtoolsPage.locator('[role^="menuitem"]').evaluateAll((elements) =>
      elements.map((element) => ({
        role: element.getAttribute("role"),
        checked: element.getAttribute("aria-checked"),
        text: element.textContent?.trim()
      }))
    );
    process.stdout.write(`Column menu for ${columnName}: ${JSON.stringify(menuItems)}\n`);
  }
  const columnItem = devtoolsPage.getByText(columnName, { exact: true }).filter({ visible: true });
  if (!(await columnItem.count())) {
    await devtoolsPage.keyboard.press("Escape");
    return false;
  }
  await columnItem.last().click({ force: true });
  await devtoolsPage.waitForTimeout(250);
  return true;
}

async function configureNetworkColumns(devtoolsPage) {
  await enableNetworkColumn(devtoolsPage, "Protocol");
  await enableNetworkColumn(devtoolsPage, "Connection ID");
  await enableNetworkColumn(devtoolsPage, "Remote address");
}

async function reloadInspectedTarget(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  async function command(method, params = {}) {
    const id = nextId;
    nextId += 1;
    const response = new Promise((resolve, reject) => {
      const listener = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        socket.removeEventListener("message", listener);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      };
      socket.addEventListener("message", listener);
    });
    socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  try {
    await command("Network.enable");
    await command("Network.setCacheDisabled", { cacheDisabled: true });
    await command("Page.reload", { ignoreCache: true });
    await wait(4_000);
  } finally {
    socket.close();
  }
}

async function showHeadersFor(devtoolsPage, resourcePattern) {
  const exactResource = devtoolsPage.locator(`.data-grid-data-grid-node:has-text("${resourcePattern}")`).filter({
    visible: true
  });
  if (await exactResource.count()) {
    await exactResource.first().click();
    await devtoolsPage.keyboard.press("Enter");
    await devtoolsPage.waitForTimeout(1_500);
    if (args.debug) {
      const sections = devtoolsPage.getByText(/^(Response headers|Request headers)$/).filter({ visible: true });
      for (let index = 0; index < (await sections.count()); index += 1) {
        const section = sections.nth(index);
        process.stdout.write(`Header section: ${await section.evaluate((element) => element.parentElement?.outerHTML)}\n`);
      }
    }
    return true;
  }

  const rows = devtoolsPage.locator(".data-grid-data-grid-node");
  if (await rows.count()) {
    await rows.first().click();
    await devtoolsPage.waitForTimeout(500);
    return true;
  }
  return false;
}

async function captureCase(testCase, index) {
  const port = 9340 + index;
  const profileDirectory = await fs.mkdtemp(path.join(os.tmpdir(), `http-devtools-${testCase.id}-`));
  const logPath = path.join(chromeLogDirectory, `${testCase.id}-chrome.log`);
  const logHandle = await fs.open(logPath, "w");
  const targetUrl = new URL(testCase.url);
  if (targetUrl.hostname === "127.0.0.1") targetUrl.searchParams.set("run", `devtools-${testCase.id}-${Date.now()}`);

  const targetArguments = [
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${profileDirectory}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-extensions",
    "--disable-sync",
    "--no-sandbox",
    "--ignore-certificate-errors",
    "--window-size=1365,768"
  ];
  if (testCase.disableQuic) targetArguments.push("--disable-quic");
  targetArguments.push(targetUrl.href);

  const targetBrowser = spawn(
    chromium.executablePath(),
    targetArguments,
    { stdio: ["ignore", logHandle.fd, logHandle.fd] }
  );

  let inspectorBrowser;
  try {
    const inspectedTarget = await waitForInspectedTarget(port, targetUrl.origin);
    inspectorBrowser = await chromium.launch({
      headless: true,
      args: [
        "--disable-web-security",
        "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests"
      ]
    });
    const inspectorContext = await inspectorBrowser.newContext({
      viewport: { width: 1700, height: 950 },
      deviceScaleFactor: 1
    });
    const devtoolsPage = await inspectorContext.newPage();
    await devtoolsPage.goto(inspectedTarget.devtoolsFrontendUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });
    await devtoolsPage.waitForTimeout(3_000);
    if (args.debug) {
      const readyDiagnosticPath = path.join(outputDirectory, `${testCase.id}-devtools-ready.png`);
      await devtoolsPage.screenshot({ path: readyDiagnosticPath });
    }
    const disconnected = devtoolsPage.getByText("Debugging connection was closed", { exact: true });
    if (await disconnected.count()) {
      const diagnosticPath = path.join(outputDirectory, `${testCase.id}-devtools-disconnected.png`);
      await devtoolsPage.screenshot({ path: diagnosticPath });
      throw new Error(`DevTools disconnected from ${testCase.id}; diagnostic saved to ${diagnosticPath}`);
    }
    await dismissLanguageBanner(devtoolsPage);
    await hideTargetScreencast(devtoolsPage);
    await openNetworkPanel(devtoolsPage);
    await enableDisableCache(devtoolsPage);
    await reloadInspectedTarget(inspectedTarget.webSocketDebuggerUrl);
    await configureNetworkColumns(devtoolsPage);

    const networkPath = path.join(outputDirectory, testCase.networkFile);
    await devtoolsPage.screenshot({ path: networkPath });

    const additionalNetworkScreenshots = [];
    for (const filename of testCase.additionalNetworkFiles ?? []) {
      await reloadInspectedTarget(inspectedTarget.webSocketDebuggerUrl);
      const additionalPath = path.join(outputDirectory, filename);
      await devtoolsPage.screenshot({ path: additionalPath });
      additionalNetworkScreenshots.push(path.relative(ROOT, additionalPath));
    }

    const selected = await showHeadersFor(devtoolsPage, testCase.resourcePattern);
    const headersPath = path.join(outputDirectory, testCase.headersFile);
    await devtoolsPage.screenshot({ path: headersPath });

    return {
      id: testCase.id,
      inspected_url: targetUrl.href,
      network_screenshot: path.relative(ROOT, networkPath),
      additional_network_screenshots: additionalNetworkScreenshots,
      headers_screenshot: path.relative(ROOT, headersPath),
      resource_selected: selected,
      chrome_log: path.relative(ROOT, logPath)
    };
  } finally {
    if (inspectorBrowser) await inspectorBrowser.close();
    if (!targetBrowser.killed) targetBrowser.kill();
    await wait(750);
    await logHandle.close();
    const resolvedProfile = path.resolve(profileDirectory);
    const resolvedTemp = path.resolve(os.tmpdir());
    if (resolvedProfile.startsWith(`${resolvedTemp}${path.sep}`)) {
      await fs.rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}

const results = [];
for (const [index, testCase] of selectedCases.entries()) {
  process.stdout.write(`Capturing ${testCase.id} DevTools evidence...\n`);
  results.push(await captureCase(testCase, index));
}

const manifestPath = path.join(chromeLogDirectory, "capture-manifest.json");
let previousResults = [];
try {
  previousResults = JSON.parse(await fs.readFile(manifestPath, "utf8")).results ?? [];
} catch {
  // The first capture has no previous manifest.
}
const mergedResults = new Map(previousResults.map((result) => [result.id, result]));
for (const result of results) mergedResults.set(result.id, result);
await fs.writeFile(
  manifestPath,
  `${JSON.stringify({ generated_at: new Date().toISOString(), results: [...mergedResults.values()] }, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`Saved ${manifestPath}\n`);
