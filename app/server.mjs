import http from "node:http";
import { performance } from "node:perf_hooks";

const HOST = "0.0.0.0";
const PORT = 3000;
const IMAGE_COUNT = 24;
const IMAGE_DELAY_MS = 100;

const runConcurrency = new Map();

function nowMs() {
  return Number(performance.now().toFixed(3));
}

function writeLog(event) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
}

function concurrencyFor(runId) {
  if (!runConcurrency.has(runId)) runConcurrency.set(runId, { active: 0, peak: 0 });
  return runConcurrency.get(runId);
}

function commonHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
}

function send(res, status, contentType, body, extraHeaders = {}) {
  const payload = Buffer.from(body, "utf8");
  res.writeHead(status, {
    ...commonHeaders(contentType),
    "Content-Length": payload.byteLength,
    ...extraHeaders
  });
  res.end(payload);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function htmlPage(runId) {
  const query = `?run=${encodeURIComponent(runId)}`;
  const images = Array.from({ length: IMAGE_COUNT }, (_, index) => {
    const id = String(index + 1).padStart(2, "0");
    return `<figure><img src="/img/${id}.svg${query}" width="240" height="140" alt="Delayed tile ${id}"><figcaption>Tile ${id}</figcaption></figure>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HTTP Multiplexing Experiment</title>
  <link rel="preload" href="/favicon.svg${query}" as="image" type="image/svg+xml">
  <link rel="icon" href="/favicon.svg${query}" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css${query}">
  <script defer src="/app.js${query}"></script>
</head>
<body data-run-id="${escapeHtml(runId)}">
  <header>
    <p class="eyebrow">Controlled browser workload</p>
    <h1>HTTP request scheduling experiment</h1>
    <p>Twenty-four same-origin SVG resources, each released after a 100 ms server delay.</p>
  </header>
  <main id="gallery" aria-label="Delayed SVG gallery">
    ${images}
  </main>
  <footer><span id="status">Loading resources...</span></footer>
</body>
</html>`;
}

const STYLES = `
:root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; background: #f4f6f8; color: #18212b; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; }
header, footer { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
header { padding: 34px 0 20px; }
.eyebrow { margin: 0 0 8px; color: #526579; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 0 0 10px; font-size: clamp(28px, 4vw, 46px); line-height: 1.08; }
header > p:last-child { margin: 0; max-width: 760px; color: #536170; line-height: 1.55; }
#gallery { width: min(1180px, calc(100% - 40px)); margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
figure { margin: 0; padding: 10px; border: 1px solid #d8dee5; border-radius: 8px; background: #fff; box-shadow: 0 2px 8px rgba(25, 40, 55, .05); }
img { display: block; width: 100%; height: auto; aspect-ratio: 12 / 7; background: #e8edf2; border-radius: 5px; }
figcaption { padding-top: 8px; color: #596b7d; font-size: 13px; }
footer { padding: 18px 0 30px; color: #526579; font-size: 13px; }
`;

const APP_JS = `
window.addEventListener("load", () => {
  const status = document.getElementById("status");
  if (status) status.textContent = "All declared page resources completed.";
});
`;

function svgTile(id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140" role="img" aria-label="Delayed tile ${id}"><rect width="240" height="140" rx="10" fill="#dce7f2"/><path d="M0 104 L58 57 L105 92 L154 42 L240 112 V140 H0 Z" fill="#8ca9c4"/><circle cx="194" cy="38" r="17" fill="#f2bf63"/><text x="18" y="30" font-family="Arial,sans-serif" font-size="16" fill="#23384d">Resource ${id}</text></svg>`;
}

function favicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#23384d"/><path d="M14 20h36v8H14zm0 16h36v8H14z" fill="#f2bf63"/></svg>`;
}

const server = http.createServer((req, res) => {
  const receivedAtMs = nowMs();
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const runId = url.searchParams.get("run") || "manual";
  const socket = `${req.socket.remoteAddress ?? "unknown"}:${req.socket.remotePort ?? "unknown"}`;

  if (url.pathname === "/healthz") {
    send(res, 200, "text/plain; charset=utf-8", "ok\n");
    return;
  }

  writeLog({
    event: "request_start",
    run_id: runId,
    method: req.method,
    path: url.pathname,
    received_at_ms: receivedAtMs,
    upstream_socket: socket
  });

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "text/plain; charset=utf-8", "Method Not Allowed\n", { Allow: "GET, HEAD" });
    return;
  }

  if (url.pathname === "/") {
    send(res, 200, "text/html; charset=utf-8", htmlPage(runId));
    return;
  }

  if (url.pathname === "/styles.css") {
    send(res, 200, "text/css; charset=utf-8", STYLES);
    return;
  }

  if (url.pathname === "/app.js") {
    send(res, 200, "text/javascript; charset=utf-8", APP_JS);
    return;
  }

  if (url.pathname === "/favicon.svg") {
    send(res, 200, "image/svg+xml; charset=utf-8", favicon());
    return;
  }

  const imageMatch = /^\/img\/(\d{2})\.svg$/.exec(url.pathname);
  if (imageMatch && Number(imageMatch[1]) >= 1 && Number(imageMatch[1]) <= IMAGE_COUNT) {
    const id = imageMatch[1];
    const concurrency = concurrencyFor(runId);
    concurrency.active += 1;
    concurrency.peak = Math.max(concurrency.peak, concurrency.active);
    writeLog({
      event: "svg_delay_start",
      run_id: runId,
      path: url.pathname,
      upstream_socket: socket,
      active_svg_requests: concurrency.active,
      peak_active_svg_requests: concurrency.peak
    });

    setTimeout(() => {
      const responseStartedAtMs = nowMs();
      send(res, 200, "image/svg+xml; charset=utf-8", svgTile(id), {
        "Server-Timing": `app;dur=${IMAGE_DELAY_MS}`
      });
      concurrency.active -= 1;
      writeLog({
        event: "request_end",
        run_id: runId,
        path: url.pathname,
        status: 200,
        received_at_ms: receivedAtMs,
        response_started_at_ms: responseStartedAtMs,
        elapsed_ms: Number((responseStartedAtMs - receivedAtMs).toFixed(3)),
        upstream_socket: socket,
        active_svg_requests: concurrency.active,
        peak_active_svg_requests: concurrency.peak
      });
      if (concurrency.active === 0) runConcurrency.delete(runId);
    }, IMAGE_DELAY_MS);
    return;
  }

  send(res, 404, "text/plain; charset=utf-8", "Not Found\n");
});

server.keepAliveTimeout = 10_000;
server.headersTimeout = 12_000;

server.listen(PORT, HOST, () => {
  writeLog({ event: "server_ready", host: HOST, port: PORT, pid: process.pid });
});

function shutdown(signal) {
  writeLog({ event: "server_shutdown", signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
