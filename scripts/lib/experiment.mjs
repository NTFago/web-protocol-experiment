import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const playwrightVersion = require("playwright/package.json").version;

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const CONDITIONS = Object.freeze({
  h1: { name: "h1", url: "https://127.0.0.1:8441/", expectedProtocol: "http/1.1" },
  h2: { name: "h2", url: "https://127.0.0.1:8442/", expectedProtocol: "h2" },
  h3: { name: "h3", url: "https://127.0.0.1:8443/", expectedProtocol: "h3" }
});
export const EXPECTED_TEST_REQUESTS = 28;
export const EXPECTED_SVG_REQUESTS = 24;

export async function localCertificateSpkiSha256() {
  const certificatePath = path.join(ROOT, "nginx", "certs", "localhost.crt");
  const certificatePem = await readFile(certificatePath, "utf8");
  const certificate = new crypto.X509Certificate(certificatePem);
  const spki = certificate.publicKey.export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(spki).digest("base64");
}

export async function localH3LaunchArguments(netLogPath = null) {
  const spkiSha256 = await localCertificateSpkiSha256();
  const launchArguments = [
    "--enable-quic",
    "--origin-to-force-quic-on=127.0.0.1:8443",
    `--ignore-certificate-errors-spki-list=${spkiSha256}`
  ];
  if (netLogPath) {
    launchArguments.push(`--log-net-log=${netLogPath}`, "--net-log-capture-mode=Default");
  }
  return { launchArguments, spkiSha256 };
}

export async function ensureArtifactDirectories() {
  const directories = [
    "raw/h1",
    "raw/h2",
    "raw/warmup/h1",
    "raw/warmup/h2",
    "raw/h3-observation",
    "har",
    "screenshots/automated",
    "screenshots/manual-devtools",
    "logs",
    "processed",
    "figures",
    "netlog"
  ];
  await Promise.all(directories.map((directory) => mkdir(path.join(ROOT, directory), { recursive: true })));
}

export function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function pad(number, width = 2) {
  return String(number).padStart(width, "0");
}

export function parseArguments(argv, defaults = {}) {
  const parsed = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

export function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isTestPath(pathname) {
  return pathname === "/"
    || pathname === "/styles.css"
    || pathname === "/app.js"
    || pathname === "/favicon.svg"
    || /^\/img\/(?:0[1-9]|1\d|2[0-4])\.svg$/.test(pathname);
}

function isSvgPath(pathname) {
  return /^\/img\/(?:0[1-9]|1\d|2[0-4])\.svg$/.test(pathname);
}

function classifyUrl(rawUrl, targetOrigin) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.origin !== targetOrigin) return { targetOrigin: false, test: false, svg: false, pathname: parsed.pathname };
    return {
      targetOrigin: true,
      test: isTestPath(parsed.pathname),
      svg: isSvgPath(parsed.pathname),
      pathname: parsed.pathname
    };
  } catch {
    return { targetOrigin: false, test: false, svg: false, pathname: null };
  }
}

function numericOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function eventRecord(records, requestId) {
  if (!records.has(requestId)) records.set(requestId, { requestId });
  return records.get(requestId);
}

function extractRequest(record, performanceEntry, targetOrigin) {
  const response = record.response ?? {};
  const timing = response.timing ?? {};
  const classification = classifyUrl(record.request?.url ?? "", targetOrigin);
  return {
    requestId: record.requestId,
    url: record.request?.url ?? null,
    pathname: classification.pathname,
    isTargetOrigin: classification.targetOrigin,
    isTestResource: classification.test,
    isSvg: classification.svg,
    resourceType: record.resourceType ?? null,
    method: record.request?.method ?? null,
    status: numericOrNull(response.status),
    mimeType: response.mimeType ?? null,
    protocol: response.protocol ?? null,
    connectionId: response.connectionId ?? null,
    connectionReused: response.connectionReused ?? null,
    remoteIPAddress: response.remoteIPAddress ?? null,
    remotePort: response.remotePort ?? null,
    fromDiskCache: response.fromDiskCache ?? false,
    fromServiceWorker: response.fromServiceWorker ?? false,
    requestHeaders: record.request?.headers ?? null,
    requestExtraHeaders: record.requestExtra?.headers ?? null,
    responseHeaders: response.headers ?? null,
    responseExtraHeaders: record.responseExtra?.headers ?? null,
    responseHeadersText: record.responseExtra?.headersText ?? null,
    requestTime: numericOrNull(timing.requestTime),
    sendStart: numericOrNull(timing.sendStart),
    sendEnd: numericOrNull(timing.sendEnd),
    receiveHeadersStart: numericOrNull(timing.receiveHeadersStart),
    receiveHeadersEnd: numericOrNull(timing.receiveHeadersEnd),
    loadingFinishedTimestamp: numericOrNull(record.loadingFinished?.timestamp),
    encodedDataLength: numericOrNull(record.loadingFinished?.encodedDataLength),
    errorText: record.loadingFailed?.errorText ?? null,
    performanceStartTime: numericOrNull(performanceEntry?.startTime),
    performanceResponseStart: numericOrNull(performanceEntry?.responseStart),
    performanceResponseEnd: numericOrNull(performanceEntry?.responseEnd),
    performanceTtfbMs: performanceEntry
      ? numericOrNull(performanceEntry.responseStart - performanceEntry.startTime)
      : null
  };
}

function validateRun(condition, requests, pageMetrics, navigationError, networkIdleTimedOut) {
  const reasons = [];
  const testRequests = requests.filter((request) => request.isTestResource);
  const svgRequests = testRequests.filter((request) => request.isSvg);
  const documentRequest = testRequests.find((request) => request.resourceType === "Document" && request.pathname === "/");

  if (navigationError) reasons.push(`navigation_error:${navigationError}`);
  if (networkIdleTimedOut) reasons.push("networkidle_timeout");
  if (testRequests.length !== EXPECTED_TEST_REQUESTS) {
    reasons.push(`test_request_count:${testRequests.length}`);
  }
  if (svgRequests.length !== EXPECTED_SVG_REQUESTS) {
    reasons.push(`svg_request_count:${svgRequests.length}`);
  }
  if (svgRequests.some((request) => request.status !== 200)) reasons.push("svg_status_not_200");
  if (testRequests.some((request) => request.errorText)) reasons.push("loading_failed");
  if (!documentRequest) {
    reasons.push("document_request_missing");
  } else if (documentRequest.protocol !== condition.expectedProtocol) {
    reasons.push(`document_protocol:${documentRequest.protocol ?? "missing"}`);
  }
  if (testRequests.some((request) => request.protocol && request.protocol !== condition.expectedProtocol)) {
    reasons.push("mixed_or_unexpected_protocol");
  }
  if (testRequests.some((request) => request.fromDiskCache)) reasons.push("disk_cache_hit");
  if (testRequests.some((request) => request.fromServiceWorker)) reasons.push("service_worker_hit");
  if (!pageMetrics.navigation) reasons.push("navigation_timing_missing");

  return [...new Set(reasons)];
}

export async function runSingle(browser, options) {
  const {
    condition,
    runId,
    pairId = null,
    orderInPair = null,
    blockId = null,
    orderInBlock = null,
    phase = "measured",
    screenshotPath = null,
    harPath = null,
    includeRawCdpEvents = false
  } = options;

  const targetOrigin = new URL(condition.url).origin;
  const records = new Map();
  const rawCdpEvents = [];
  let context;
  let page;
  let cdp;
  let navigationError = null;
  let networkIdleTimedOut = false;
  let pageMetrics = { navigation: null, resources: [], lcp: null };

  const contextOptions = {
    ignoreHTTPSErrors: true,
    viewport: { width: 1365, height: 768 },
    deviceScaleFactor: 1,
    serviceWorkers: "block"
  };
  if (harPath) {
    contextOptions.recordHar = { path: harPath, content: "embed", mode: "full" };
  }

  const capture = (method, parameters) => {
    if (includeRawCdpEvents) rawCdpEvents.push({ method, parameters });
    const record = eventRecord(records, parameters.requestId);
    if (method === "Network.requestWillBeSent") {
      record.request = parameters.request;
      record.resourceType = parameters.type;
      record.requestTimestamp = parameters.timestamp;
      record.wallTime = parameters.wallTime;
    } else if (method === "Network.requestWillBeSentExtraInfo") {
      record.requestExtra = parameters;
    } else if (method === "Network.responseReceived") {
      record.response = parameters.response;
      record.resourceType = parameters.type;
      record.responseTimestamp = parameters.timestamp;
    } else if (method === "Network.responseReceivedExtraInfo") {
      record.responseExtra = parameters;
    } else if (method === "Network.loadingFinished") {
      record.loadingFinished = parameters;
    } else if (method === "Network.loadingFailed") {
      record.loadingFailed = parameters;
    }
  };

  try {
    context = await browser.newContext(contextOptions);
    page = await context.newPage();
    cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });

    for (const method of [
      "Network.requestWillBeSent",
      "Network.requestWillBeSentExtraInfo",
      "Network.responseReceived",
      "Network.responseReceivedExtraInfo",
      "Network.loadingFinished",
      "Network.loadingFailed"
    ]) {
      cdp.on(method, (parameters) => capture(method, parameters));
    }

    await page.addInitScript(() => {
      window.__latestLcp = null;
      try {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (!entries.length) return;
          const entry = entries[entries.length - 1];
          window.__latestLcp = {
            startTime: entry.startTime,
            size: entry.size,
            url: entry.url || null,
            element: entry.element ? entry.element.tagName : null
          };
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        window.__latestLcp = null;
      }
    });

    const runUrl = new URL(condition.url);
    runUrl.searchParams.set("run", runId);
    try {
      await page.goto(runUrl.href, { waitUntil: "load", timeout: 15_000 });
    } catch (error) {
      navigationError = error instanceof Error ? error.message : String(error);
    }

    if (!navigationError) {
      try {
        await page.waitForLoadState("networkidle", { timeout: 5_000 });
      } catch {
        networkIdleTimedOut = true;
      }
      await page.waitForTimeout(150);

      pageMetrics = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        const resources = performance.getEntriesByType("resource").map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          startTime: entry.startTime,
          responseStart: entry.responseStart,
          responseEnd: entry.responseEnd,
          duration: entry.duration,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize
        }));
        return {
          navigation: navigation ? {
            startTime: navigation.startTime,
            responseStart: navigation.responseStart,
            domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
            loadEventEnd: navigation.loadEventEnd,
            duration: navigation.duration,
            transferSize: navigation.transferSize,
            encodedBodySize: navigation.encodedBodySize,
            decodedBodySize: navigation.decodedBodySize
          } : null,
          resources,
          lcp: window.__latestLcp
        };
      });

      if (screenshotPath) {
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }
    }
  } finally {
    if (context) await context.close();
  }

  const performanceEntries = new Map(pageMetrics.resources.map((entry) => [entry.name, entry]));
  const requests = [...records.values()]
    .filter((record) => record.request?.url)
    .map((record) => extractRequest(record, performanceEntries.get(record.request.url), targetOrigin))
    .sort((left, right) => (left.requestTime ?? Number.MAX_VALUE) - (right.requestTime ?? Number.MAX_VALUE));

  const testRequests = requests.filter((request) => request.isTestResource);
  const unexpectedRequests = requests.filter((request) => request.isTargetOrigin && !request.isTestResource);
  const svgEntries = pageMetrics.resources.filter((entry) => {
    try {
      return new URL(entry.name).origin === targetOrigin && isSvgPath(new URL(entry.name).pathname);
    } catch {
      return false;
    }
  });
  const resourceCompletionSpanMs = svgEntries.length
    ? Math.max(...svgEntries.map((entry) => entry.responseEnd)) - Math.min(...svgEntries.map((entry) => entry.startTime))
    : null;
  const connectionIds = new Set(
    testRequests
      .map((request) => request.connectionId)
      .filter((value) => value !== null && value !== undefined)
      .map(String)
  );
  const protocolSet = [...new Set(testRequests.map((request) => request.protocol).filter(Boolean))].sort();
  const documentRequest = testRequests.find((request) => request.resourceType === "Document" && request.pathname === "/");
  const validationReasons = validateRun(condition, requests, pageMetrics, navigationError, networkIdleTimedOut);
  const navigation = pageMetrics.navigation;

  return {
    run_id: runId,
    timestamp: new Date().toISOString(),
    phase,
    pair_id: pairId,
    order_in_pair: orderInPair,
    block_id: blockId,
    order_in_block: orderInBlock,
    condition: condition.name,
    url: condition.url,
    os_version: `${os.platform()} ${os.release()}`,
    browser_version: browser.version(),
    playwright_version: playwrightVersion,
    viewport: { width: 1365, height: 768, deviceScaleFactor: 1 },
    wait_strategy: "load_then_networkidle_5s_then_150ms",
    test_request_count: testRequests.length,
    unexpected_request_count: unexpectedRequests.length,
    unexpected_requests: unexpectedRequests.map((request) => request.url),
    failed_request_count: testRequests.filter((request) => request.errorText).length,
    protocol_set: protocolSet,
    document_protocol: documentRequest?.protocol ?? null,
    unique_connection_count: connectionIds.size,
    nav_ttfb_ms: navigation ? navigation.responseStart - navigation.startTime : null,
    dom_content_loaded_ms: navigation?.domContentLoadedEventEnd ?? null,
    load_ms: navigation?.loadEventEnd ?? null,
    lcp_candidate_ms: pageMetrics.lcp?.startTime ?? null,
    lcp_candidate: pageMetrics.lcp,
    resource_completion_span_ms: numericOrNull(resourceCompletionSpanMs),
    total_encoded_bytes: testRequests.reduce((sum, request) => sum + (request.encodedDataLength ?? 0), 0),
    networkidle_timed_out: networkIdleTimedOut,
    valid: validationReasons.length === 0,
    invalid_reason: validationReasons.length ? validationReasons.join(";") : null,
    page_metrics: pageMetrics,
    requests,
    ...(includeRawCdpEvents ? { cdp_events: rawCdpEvents } : {})
  };
}

export async function writeJson(relativePath, value) {
  const absolutePath = path.join(ROOT, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return absolutePath;
}

export async function appendNdjson(relativePath, value) {
  const { appendFile } = await import("node:fs/promises");
  const absolutePath = path.join(ROOT, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await appendFile(absolutePath, `${JSON.stringify(value)}\n`, "utf8");
  return absolutePath;
}
