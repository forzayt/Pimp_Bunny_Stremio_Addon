"use strict";

// ===========================================================================
// PornAPI Stremio addon server
// ---------------------------------------------------------------------------
// Serves the Stremio addon protocol, a small landing page and diagnostics.
// Video bytes are never proxied: Stremio receives the direct MP4 URL from
// PornAPI's own CDN, so this server stays cheap to run.
// ===========================================================================

const express = require("express");
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const pkg = require("./package.json");

const app = express();
const PORT = Number(process.env.PORT) || 7000;
const HOST_URL = (
  process.env.HOST_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${PORT}`
).replace(/\/+$/, "");
const STARTED_AT = Date.now();

const EXPECTED_CATALOGS = (addonInterface.manifest.catalogs || []).map((catalog) => catalog.name);

app.disable("x-powered-by");
app.set("trust proxy", true);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------
app.get("/", (req, res) => {
  const manifestUrl = `${HOST_URL}/manifest.json`;
  const version = addonInterface.manifest.version || pkg.version;
  const catalogs = EXPECTED_CATALOGS.map((name) => `<li>${name}</li>`).join("");

  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>PornAPI · Stremio Addon</title>
  <link rel="icon" href="https://pornapi.sbs/wp-content/uploads/2026/10/movish_icon-150x150.png" />
  <style>
    :root {
      --bg: #07080d;
      --panel: rgba(18, 20, 30, 0.78);
      --line: rgba(255, 255, 255, 0.09);
      --text: #e9eaf2;
      --muted: #979bb0;
      --accent: #ff2d55;
      --accent-2: #ff8a3d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--text);
      background: var(--bg);
      overflow-x: hidden;
    }
    .glow {
      position: fixed; inset: 0; z-index: -1; pointer-events: none;
      background:
        radial-gradient(480px 480px at 18% 6%, rgba(255, 45, 85, 0.18), transparent 70%),
        radial-gradient(520px 520px at 82% 22%, rgba(255, 138, 61, 0.12), transparent 70%),
        radial-gradient(560px 560px at 50% 100%, rgba(120, 60, 255, 0.12), transparent 70%);
    }
    .wrap { max-width: 1060px; margin: 0 auto; padding: 0 22px; }
    header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 0; border-bottom: 1px solid var(--line);
    }
    .brand { display: flex; align-items: center; gap: 11px; font-weight: 700; letter-spacing: -0.01em; }
    .mark {
      width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
      font-size: 13px; font-weight: 800; color: #fff;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      box-shadow: 0 8px 26px rgba(255, 45, 85, 0.35);
    }
    .brand small { display: block; font-size: 11px; font-weight: 500; color: var(--muted); letter-spacing: 0.04em; }
    nav { display: flex; gap: 8px; }
    nav a {
      color: var(--text); text-decoration: none; font-size: 13px; font-weight: 600;
      padding: 8px 13px; border: 1px solid var(--line); border-radius: 9px;
      background: rgba(255, 255, 255, 0.03); transition: 0.18s ease;
    }
    nav a:hover { border-color: rgba(255, 45, 85, 0.5); background: rgba(255, 45, 85, 0.1); }
    .hero { padding: 74px 0 48px; }
    .badge {
      display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;
      color: #ffd3dc; background: rgba(255, 45, 85, 0.1);
      border: 1px solid rgba(255, 45, 85, 0.3); border-radius: 999px; padding: 6px 12px;
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #3ddc84; box-shadow: 0 0 0 4px rgba(61, 220, 132, 0.13); }
    h1 {
      margin: 20px 0 14px; font-size: clamp(32px, 5.4vw, 56px); line-height: 1.05;
      letter-spacing: -0.035em; font-weight: 800;
    }
    h1 span {
      background: linear-gradient(120deg, var(--accent), var(--accent-2) 75%);
      -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
    }
    .lede { margin: 0; max-width: 660px; color: var(--muted); font-size: 17px; }
    .stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 26px 0 0; padding: 0; list-style: none; }
    .stats li {
      font-size: 12.5px; font-weight: 600; color: #cfd2e0;
      border: 1px solid var(--line); background: rgba(255, 255, 255, 0.035);
      border-radius: 999px; padding: 7px 13px;
    }
    .install {
      margin: 34px 0 0; padding: 22px; border-radius: 18px;
      border: 1px solid var(--line); background: var(--panel);
      backdrop-filter: blur(14px); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
    }
    .install label {
      display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--muted); margin-bottom: 9px;
    }
    .row { display: flex; gap: 10px; flex-wrap: wrap; }
    input {
      flex: 1 1 340px; min-width: 0; padding: 13px 15px; border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.14); background: #0c0e16;
      color: #dfe1ee; font: 13.5px ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    input:focus { outline: 2px solid rgba(255, 45, 85, 0.45); outline-offset: 1px; }
    button {
      cursor: pointer; padding: 13px 20px; border: 0; border-radius: 10px;
      font: 600 14px inherit; color: #fff;
      background: linear-gradient(135deg, var(--accent), #e11d48);
      box-shadow: 0 10px 24px rgba(255, 45, 85, 0.3); transition: 0.18s ease;
    }
    button:hover { transform: translateY(-1px); filter: brightness(1.06); }
    .hint { margin: 11px 0 0; font-size: 12.5px; color: var(--muted); }
    .hint a { color: #ff8ba1; text-decoration: none; }
    section { padding: 34px 0; }
    h2 { font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin: 0 0 18px; }
    .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(226px, 1fr)); }
    .card {
      border: 1px solid var(--line); border-radius: 14px; padding: 18px;
      background: rgba(255, 255, 255, 0.028); transition: 0.2s ease;
    }
    .card:hover { transform: translateY(-3px); border-color: rgba(255, 45, 85, 0.3); background: rgba(255, 45, 85, 0.05); }
    .card h3 { margin: 0 0 7px; font-size: 15px; letter-spacing: -0.01em; }
    .card p { margin: 0; font-size: 13px; color: var(--muted); }
    .icon {
      width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center;
      margin-bottom: 12px; background: rgba(255, 45, 85, 0.13); color: #ff7f95;
      font-size: 16px; font-weight: 700;
    }
    .catalogs { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px; }
    .catalogs li {
      font-size: 12.5px; padding: 6px 11px; border-radius: 8px;
      border: 1px solid var(--line); background: rgba(255, 255, 255, 0.035); color: #c9ccdb;
    }
    .steps { counter-reset: step; display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .step { border: 1px solid var(--line); border-radius: 14px; padding: 18px; background: rgba(255, 255, 255, 0.025); }
    .step::before {
      counter-increment: step; content: counter(step);
      display: grid; place-items: center; width: 26px; height: 26px; margin-bottom: 11px;
      border-radius: 8px; font-size: 12px; font-weight: 700; color: #e5e7f0;
      background: rgba(255, 255, 255, 0.08);
    }
    .step p { margin: 0; font-size: 13px; color: var(--muted); }
    .step strong { display: block; margin-bottom: 4px; font-size: 14px; color: var(--text); }
    footer {
      margin-top: 26px; padding: 24px 0 34px; border-top: 1px solid var(--line);
      display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between;
      font-size: 12px; color: #7c8094;
    }
    footer a { color: #a9adc0; text-decoration: none; }
    footer a:hover { color: #fff; }
    .warn { color: #ffbc75; }
    @media (max-width: 640px) { .hero { padding-top: 48px; } }
  </style>
</head>
<body>
  <div class="glow"></div>
  <div class="wrap">
    <header>
      <div class="brand">
        <div class="mark">PA</div>
        <div>PornAPI<small>STREMIO ADDON</small></div>
      </div>
      <nav>
        <a href="/manifest.json">Manifest</a>
        <a href="/health">Health</a>
      </nav>
    </header>

    <main class="hero">
      <span class="badge"><span class="dot"></span> v${version} · online</span>
      <h1>135,000+ videos,<br /><span>right inside Stremio</span></h1>
      <p class="lede">
        Browse new releases, top tags, studios and networks from the PornAPI catalogue and
        play every title in the Stremio player. Direct MP4 streams, no redirects, no proxies.
      </p>

      <ul class="stats">
        <li>135,831 videos</li>
        <li>2,451 tags</li>
        <li>972 channels</li>
        <li>274 networks</li>
        <li>Up to 4K</li>
      </ul>

      <div class="install">
        <label for="manifest">Manifest URL</label>
        <div class="row">
          <input id="manifest" type="text" value="${manifestUrl}" readonly onclick="this.select()" />
          <button id="copy" type="button">Copy URL</button>
        </div>
        <p class="hint">
          Stremio → Addons → Install community addon → paste the URL.
          Metadata and streams are cached server-side to stay well inside PornAPI rate limits.
        </p>
      </div>
    </main>

    <section>
      <h2>Catalogs</h2>
      <ul class="catalogs">${catalogs}</ul>
    </section>

    <section>
      <h2>What you get</h2>
      <div class="grid">
        <div class="card">
          <div class="icon">▶</div>
          <h3>Plays in Stremio</h3>
          <p>Direct MP4 links that Stremio can seek and play natively. Works on desktop, mobile and TV.</p>
        </div>
        <div class="card">
          <div class="icon">4K</div>
          <h3>Quality selector</h3>
          <p>Every available quality is listed separately: 4K, 720p and 480p when the source offers them.</p>
        </div>
        <div class="card">
          <div class="icon">⌕</div>
          <h3>Search &amp; filters</h3>
          <p>Search the whole catalogue, or browse by tag, studio and network using the catalog filters.</p>
        </div>
        <div class="card">
          <div class="icon">⚡</div>
          <h3>Built for rate limits</h3>
          <p>Catalog, metadata and stream lookups are cached with stale fallbacks, so the API is rarely touched.</p>
        </div>
      </div>
    </section>

    <section>
      <h2>Install</h2>
      <div class="steps">
        <div class="step">
          <strong>Open Stremio</strong>
          <p>Go to Addons → My addons and choose “Install community addon”.</p>
        </div>
        <div class="step">
          <strong>Paste the manifest</strong>
          <p>Use the URL above. The addon appears under Video addons as “PornAPI”.</p>
        </div>
        <div class="step">
          <strong>Press play</strong>
          <p>Open any title and pick a quality. Streams load straight from PornAPI’s CDN.</p>
        </div>
      </div>
    </section>

    <footer>
      <span>PornAPI Stremio Addon · v${version} · unofficial, not affiliated with PornAPI or Stremio · 18+ only</span>
      <span><a href="/manifest.json">Manifest</a> · <a href="/health">Health</a></span>
    </footer>
  </div>

  <script>
    document.getElementById("copy").addEventListener("click", async function () {
      const input = document.getElementById("manifest");
      const button = this;
      try {
        await navigator.clipboard.writeText(input.value);
      } catch (error) {
        input.select();
        document.execCommand("copy");
      }
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = "Copy URL"; }, 1800);
    });
  </script>
</body>
</html>`);
});

app.get("/favicon.ico", (req, res) => {
  res.redirect(302, "https://pornapi.sbs/wp-content/uploads/2026/10/movish_icon-150x150.png");
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
app.get("/health", async (req, res) => {
  let health;
  try {
    health = await addonInterface.health();
  } catch (error) {
    health = { upstream: { ok: false, error: error.message }, api: addonInterface.stats() };
  }

  res.json({
    status: health.upstream.ok ? "ok" : "degraded",
    addon: {
      id: addonInterface.manifest.id,
      version: addonInterface.manifest.version,
      catalogs: (addonInterface.manifest.catalogs || []).length,
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
    },
    upstream: health.upstream,
    api: health.api,
  });
});

// Inspect what the current caches would return for a video.
app.get("/debug/video/:id", async (req, res) => {
  const id = String(req.params.id || "").replace(/^pvl:/, "");
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: "id must be numeric" });

  const payload = { id: `pvl:${id}`, meta: null, streams: [], errors: [] };

  try {
    payload.meta = await addonInterface.getMeta(id);
  } catch (error) {
    payload.errors.push(`meta: ${error.message}`);
  }

  try {
    payload.streams = await addonInterface.getStreams(id);
  } catch (error) {
    payload.errors.push(`stream: ${error.message}`);
  }

  return res.json(payload);
});

// Stremio addon protocol (/manifest.json, /catalog/..., /meta/..., /stream/...)
app.use("/", getRouter(addonInterface));

app.use((req, res) => {
  res.status(404).json({ error: "not found" });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] PornAPI addon v${addonInterface.manifest.version} on port ${PORT}`);
  console.log(`[server] Manifest: ${HOST_URL}/manifest.json`);
  console.log(
    `[server] PornAPI key: ${process.env.PORNAPI_KEY ? "configured" : "not set (public, rate-limited mode)"}`
  );
});

function shutdown(signal) {
  console.log(`[server] ${signal} received, closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
