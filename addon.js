"use strict";

// ===========================================================================
// PornAPI Stremio addon
// ---------------------------------------------------------------------------
// Catalogue + metadata come from the PornAPI REST API. Direct MP4 URLs are
// extracted from the API's embed page (the API itself only exposes an iframe).
//
// Every upstream call is cached aggressively because the API is rate limited
// per IP/key. Stream tokens are valid for ~6 hours, so cached direct URLs are
// served for at most 2.5 hours before a fresh embed page is requested.
// ===========================================================================

const { addonBuilder } = require("stremio-addon-sdk");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORNAPI_BASE = (
  process.env.PORNAPI_BASE || "https://pornapi.sbs/wp-json/video-library/v1"
).replace(/\/+$/, "");
const PORNAPI_EMBED_BASE = (process.env.PORNAPI_EMBED_BASE || "https://pornapi.sbs").replace(
  /\/+$/,
  ""
);
const PORNAPI_KEY = (process.env.PORNAPI_KEY || "").trim();
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const API_TIMEOUT_MS = 15000;
const EMBED_TIMEOUT_MS = 15000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Cache TTLs (fresh window, then optional stale window for upstream failures)
const TTL = {
  catalogNew: 10 * MINUTE,
  catalogPopular: 30 * MINUTE,
  catalog4k: 30 * MINUTE,
  catalogGenre: 3 * HOUR,
  search: 12 * HOUR,
  meta: 24 * HOUR,
  metaStale: 30 * DAY,
  stream: 2 * HOUR,
  streamStale: 30 * MINUTE,
  stats: 10 * MINUTE,
};

const CATALOG_PAGE_SIZE = 100; // Stremio asks for 100 items per page
const API_MAX_PER_PAGE = 100;

// ---------------------------------------------------------------------------
// Curated taxonomy (real PornAPI slugs, ordered by video count)
// ---------------------------------------------------------------------------
const TAG_OPTIONS = [
  "Blowjob", "Brunette", "4K", "Blonde", "Shaved", "Big Tits", "Deepthroat",
  "Pussy Licking", "Tattoo", "Facial", "Doggystyle", "Big Cock", "Cumshot",
  "HD", "Natural Tits", "Cowgirl", "Missionary", "Small Tits", "Handjob",
  "Reverse Cowgirl", "Anal", "POV", "Big Ass", "MILF", "Piercing",
  "Masturbation", "Hardcore", "European", "Teen", "Spanking", "Amateur",
  "Interracial", "High Heels", "Athletic", "Trimmed", "Short Hair", "Lesbian",
  "Sex Toys", "Kissing", "Lingerie",
];

const CHANNEL_OPTIONS = [
  "Brazzers", "Wow Girls", "Mature.nl", "Club Sweethearts", "SEXMEX", "BANG.com",
  "SexArt", "Lustery", "We Are Hairy", "New Sensations", "RK Prime", "MYLF",
  "Team Skeet X Series", "Tainster", "Porn World", "Private", "Girls Out West",
  "Hot Guys Fuck", "Aunt Judys", "Czech Casting", "Babes.com", "Nubile Films",
  "Passion HD", "Rocco Siffredi", "Digital Playground", "HardX", "Joymii",
  "FTV Girls",
];

const NETWORK_OPTIONS = [
  "Adult Time", "Team Skeet", "Brazzers", "Reality Kings", "Bangbros",
  "AdultPrime", "PornPros", "Naughty America", "MYLF", "Wow Porn", "Porn Box",
  "Nubiles Porn", "DDF Network", "FakeHub", "TUSHY", "Mature.nl", "Sexy Hub",
  "BANG.com", "SEXMEX", "MetArt", "XEmpire", "Lustery", "MOFOS", "FEMJOY",
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function log(...args) {
  console.log("[pornapi]", ...args);
}

function warn(...args) {
  console.warn("[pornapi]", ...args);
}

function posterOf(item) {
  const poster = item && item.poster;
  if (!poster) return "";
  if (typeof poster === "string") return poster;
  return poster.local_url || poster.url || "";
}

function formatRuntime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return undefined;
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}min`;
  if (hours) return `${hours}h`;
  return `${minutes}min`;
}

function qualityRank(quality) {
  const value = String(quality || "");
  if (/^4k$/i.test(value)) return 2160;
  const match = value.match(/(\d{3,4})/);
  return match ? parseInt(match[1], 10) : 0;
}

function qualityLabel(quality) {
  const value = String(quality || "");
  if (/^4k$/i.test(value)) return "4K";
  return value;
}

function safeFilename(name, quality) {
  const base = String(name || "video")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
  return `${base || "video"} [${qualityLabel(quality)}].mp4`;
}

function numericId(id) {
  const match = /^(?:pvl:)?(\d+)$/.exec(String(id || ""));
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// TTL cache with in-flight coalescing, stale-on-error and simple LRU bounds
// ---------------------------------------------------------------------------
const cache = new Map(); // key -> { value, freshUntil, staleUntil }
const inflight = new Map(); // key -> Promise
const MAX_CACHE_ENTRIES = 3000;

function touchCache(key, entry) {
  cache.delete(key);
  cache.set(key, entry);

  if (cache.size <= MAX_CACHE_ENTRIES) return;

  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.staleUntil <= now) cache.delete(k);
    if (cache.size <= MAX_CACHE_ENTRIES) return;
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

function cacheSet(key, value, ttl, stale = 0) {
  const now = Date.now();
  touchCache(key, { value, freshUntil: now + ttl, staleUntil: now + ttl + stale });
  return value;
}

async function cached(key, { ttl, stale = 0, loader }) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now < hit.freshUntil) {
    touchCache(key, hit);
    return hit.value;
  }

  // One upstream request per key, even under concurrent Stremio requests.
  if (inflight.has(key)) {
    try {
      return await inflight.get(key);
    } catch (error) {
      if (hit && now < hit.staleUntil) {
        warn(`serving stale cache for ${key}: ${error.message}`);
        return hit.value;
      }
      throw error;
    }
  }

  const promise = (async () => {
    const value = await loader();
    cacheSet(key, value, ttl, stale);
    return value;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    if (hit && now < hit.staleUntil) {
      warn(`serving stale cache for ${key}: ${error.message}`);
      return hit.value;
    }
    throw error;
  } finally {
    inflight.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Rate-limit tracking
// ---------------------------------------------------------------------------
const rateLimit = {
  limit: null,
  remaining: null,
  reset: null,
  seenAt: 0,
};
let blockedUntil = 0;
let lastApiError = null;

function noteRateLimit(response) {
  const limit = Number(response.headers.get("x-ratelimit-limit"));
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(limit) || Number.isFinite(remaining)) {
    rateLimit.limit = Number.isFinite(limit) ? limit : rateLimit.limit;
    rateLimit.remaining = Number.isFinite(remaining) ? remaining : rateLimit.remaining;
    rateLimit.reset = Number.isFinite(reset) ? reset : rateLimit.reset;
    rateLimit.seenAt = Date.now();
  }
}

class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// PornAPI client
// ---------------------------------------------------------------------------
function queryString(params = {}) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

async function apiFetch(path, params = {}) {
  const now = Date.now();
  if (now < blockedUntil) {
    throw new UpstreamError(
      `PornAPI cooldown active for ${Math.ceil((blockedUntil - now) / 1000)}s`,
      429
    );
  }

  const url = `${PORNAPI_BASE}${path}?${queryString(params)}`;
  const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
  if (PORNAPI_KEY) headers["X-VL-Key"] = PORNAPI_KEY;

  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  } catch (error) {
    lastApiError = { at: Date.now(), message: error.message, path };
    throw new UpstreamError(`PornAPI request failed: ${error.message}`, 0);
  }

  noteRateLimit(response);

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    let waitMs = 30 * 1000;
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      waitMs = retryAfter * 1000;
    } else if (Number.isFinite(reset) && reset > 0) {
      waitMs = Math.max(1000, reset * 1000 - Date.now());
    }
    blockedUntil = Date.now() + Math.min(waitMs, 10 * MINUTE);
    lastApiError = { at: Date.now(), message: "rate limited (429)", path };
    throw new UpstreamError("PornAPI rate limit reached (429)", 429);
  }

  if (!response.ok) {
    lastApiError = {
      at: Date.now(),
      message: `${response.status} ${response.statusText}`,
      path,
    };
    throw new UpstreamError(
      `PornAPI ${response.status} ${response.statusText} for ${path}`,
      response.status
    );
  }

  try {
    return await response.json();
  } catch {
    throw new UpstreamError(`PornAPI returned invalid JSON for ${path}`, response.status);
  }
}

function getApi(path, params, { ttl, stale = 0 } = {}) {
  const key = `api:${path}?${queryString(params)}`;
  return cached(key, { ttl, stale, loader: () => apiFetch(path, params) });
}

// ---------------------------------------------------------------------------
// Mapping PornAPI records to Stremio objects
// ---------------------------------------------------------------------------
function toMeta(item) {
  const poster = posterOf(item);
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const actors = Array.isArray(item.actors)
    ? item.actors.map((actor) => actor && actor.name).filter(Boolean)
    : [];
  const studio = (item.channel && item.channel.name) || (item.network && item.network.name) || "";

  const meta = {
    id: `pvl:${item.id}`,
    type: "movie",
    name: item.title || `Video ${item.id}`,
    poster,
    background: poster,
    description: item.description || "",
    genres: tags.slice(0, 8),
  };

  if (actors.length) meta.cast = actors.slice(0, 12);
  const runtime = formatRuntime(item.duration_seconds);
  if (runtime) meta.runtime = runtime;
  if (studio) meta.director = [studio];

  if (item.release_date) {
    const date = new Date(item.release_date);
    if (!Number.isNaN(date.getTime())) meta.releaseInfo = String(date.getUTCFullYear());
  }

  return meta;
}

function toCatalogMeta(item) {
  const meta = toMeta(item);
  // Catalog previews need less data; trim to keep responses small.
  delete meta.cast;
  delete meta.director;
  delete meta.runtime;
  return meta;
}

// ---------------------------------------------------------------------------
// Catalog definitions
// ---------------------------------------------------------------------------
const CATALOG_DEFS = {
  pvl_new: {
    params: { orderby: "release_date", order: "desc" },
    ttl: TTL.catalogNew,
  },
  pvl_popular: {
    params: { orderby: "views", order: "desc" },
    ttl: TTL.catalogPopular,
  },
  pvl_4k: {
    params: { has_4k: "1", orderby: "release_date", order: "desc" },
    ttl: TTL.catalog4k,
  },
  pvl_tags: {
    params: { orderby: "release_date", order: "desc" },
    genreParam: "tag",
    ttl: TTL.catalogGenre,
  },
  pvl_studios: {
    params: { orderby: "release_date", order: "desc" },
    genreParam: "channel",
    ttl: TTL.catalogGenre,
  },
  pvl_networks: {
    params: { orderby: "release_date", order: "desc" },
    genreParam: "network",
    ttl: TTL.catalogGenre,
  },
  pvl_anal: {
    params: { tag: "Anal", orderby: "release_date", order: "desc" },
    ttl: TTL.catalogGenre,
  },
  pvl_milf: {
    params: { tag: "MILF", orderby: "release_date", order: "desc" },
    ttl: TTL.catalogGenre,
  },
  pvl_amateur: {
    params: { tag: "Amateur", orderby: "release_date", order: "desc" },
    ttl: TTL.catalogGenre,
  },
  pvl_lesbian: {
    params: { tag: "Lesbian", orderby: "release_date", order: "desc" },
    ttl: TTL.catalogGenre,
  },
  pvl_pov: {
    params: { tag: "POV", orderby: "release_date", order: "desc" },
    ttl: TTL.catalogGenre,
  },
};

const manifest = {
  id: "org.pimpbunny.addon",
  version: "2.0.0",
  name: "Pimp Bunny",
  description:
    "Pimp Bunny: the largest collection of adult videos in one reliable Stremio addon. Powered by PornAPI.",
  logo: "https://pornapi.sbs/wp-content/uploads/2026/10/movish_icon-150x150.png",
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["pvl:"],
  behaviorHints: {
    adult: true,
  },
  catalogs: [
    {
      type: "movie",
      id: "pvl_new",
      name: "Pimp Bunny New Releases",
      extra: [{ name: "skip" }],
    },
    {
      type: "movie",
      id: "pvl_popular",
      name: "Pimp Bunny Most Viewed",
      extra: [{ name: "skip" }],
    },
    {
      type: "movie",
      id: "pvl_4k",
      name: "Pimp Bunny 4K Ultra HD",
      extra: [{ name: "skip" }],
    },
    {
      type: "movie",
      id: "pvl_search",
      name: "Pimp Bunny Search",
      extra: [{ name: "search", isRequired: true }, { name: "skip" }],
    },
    {
      type: "movie",
      id: "pvl_tags",
      name: "Pimp Bunny Tags",
      extra: [{ name: "genre", options: TAG_OPTIONS }, { name: "skip" }],
    },
    {
      type: "movie",
      id: "pvl_studios",
      name: "Pimp Bunny Studios",
      extra: [{ name: "genre", options: CHANNEL_OPTIONS }, { name: "skip" }],
    },
    {
      type: "movie",
      id: "pvl_networks",
      name: "Pimp Bunny Networks",
      extra: [{ name: "genre", options: NETWORK_OPTIONS }, { name: "skip" }],
    },
    {
      type: "movie",
      id: "pvl_anal",
      name: "Pimp Bunny Anal",
      extra: [{ name: "skip" }],
    },
    {
      type: "movie",
      id: "pvl_milf",
      name: "Pimp Bunny MILF",
      extra: [{ name: "skip" }],
    },
    {
      type: "movie",
      id: "pvl_amateur",
      name: "Pimp Bunny Amateur",
      extra: [{ name: "skip" }],
    },
    {
      type: "movie",
      id: "pvl_lesbian",
      name: "Pimp Bunny Lesbian",
      extra: [{ name: "skip" }],
    },
    {
      type: "movie",
      id: "pvl_pov",
      name: "Pimp Bunny POV",
      extra: [{ name: "skip" }],
    },
  ],
};

const builder = new addonBuilder(manifest);

// ---------------------------------------------------------------------------
// Catalogue handler
// ---------------------------------------------------------------------------
async function collectVideos(params, skip, limit, ttl) {
  let page = Math.floor(skip / CATALOG_PAGE_SIZE) + 1;
  let offset = skip % CATALOG_PAGE_SIZE;
  const collected = [];
  let guard = 0;

  while (collected.length < limit && guard < 4) {
    guard += 1;
    const data = await getApi(
      "/videos",
      {
        ...params,
        page,
        per_page: API_MAX_PER_PAGE,
        view: "summary",
      },
      { ttl, stale: ttl }
    );

    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) break;

    const wanted = limit - collected.length;
    collected.push(...items.slice(offset, offset + wanted));
    offset = 0;

    if (!data.pagination || !data.pagination.has_next) break;
    page += 1;
  }

  return collected.slice(0, limit);
}

async function collectSearch(query, skip, limit) {
  let page = Math.floor(skip / CATALOG_PAGE_SIZE) + 1;
  let offset = skip % CATALOG_PAGE_SIZE;
  const collected = [];
  let guard = 0;

  while (collected.length < limit && guard < 4) {
    guard += 1;
    const data = await getApi(
      "/search",
      { q: query, page, per_page: API_MAX_PER_PAGE },
      { ttl: TTL.search, stale: TTL.search }
    );

    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) break;

    const wanted = limit - collected.length;
    collected.push(...items.slice(offset, offset + wanted));
    offset = 0;

    if (!data.pagination || !data.pagination.has_next) break;
    page += 1;
  }

  return collected.slice(0, limit);
}

function rememberItems(items) {
  // Catalog responses already carry enough metadata for a meta view. Keeping a
  // copy avoids an extra API request when the user opens a video.
  for (const item of items) {
    if (!item || item.id === undefined) continue;
    cacheSet(`seed:${item.id}`, toMeta(item), TTL.meta, TTL.metaStale);
  }
}

builder.defineCatalogHandler(async ({ type, id, extra = {} }) => {
  if (type !== "movie") return { metas: [] };

  const skip = Math.max(0, parseInt(extra.skip, 10) || 0);
  const genre = typeof extra.genre === "string" ? extra.genre.trim() : "";

  try {
    if (id === "pvl_search") {
      const query = typeof extra.search === "string" ? extra.search.trim() : "";
      if (!query) return { metas: [] };
      const items = await collectSearch(query, skip, CATALOG_PAGE_SIZE);
      rememberItems(items);
      log(`search "${query}" skip=${skip} -> ${items.length} results`);
      return { metas: items.map(toCatalogMeta), cacheMaxAge: 3600 };
    }

    const def = CATALOG_DEFS[id];
    if (!def) return { metas: [] };

    const params = { ...def.params };
    if (genre && def.genreParam) params[def.genreParam] = genre;

    const items = await collectVideos(params, skip, CATALOG_PAGE_SIZE, def.ttl);
    rememberItems(items);
    log(`catalog ${id} genre="${genre}" skip=${skip} -> ${items.length} items`);
    return { metas: items.map(toCatalogMeta), cacheMaxAge: 600 };
  } catch (error) {
    warn(`catalog ${id} failed: ${error.message}`);
    return { metas: [] };
  }
});

// ---------------------------------------------------------------------------
// Meta handler
// ---------------------------------------------------------------------------
function getMeta(videoId) {
  // Prefer the catalog seed: it is complete enough and costs no API call.
  return cached(`seed:${videoId}`, {
    ttl: TTL.meta,
    stale: TTL.metaStale,
    loader: async () => {
      const item = await getApi(`/videos/${videoId}`, {}, { ttl: TTL.meta, stale: TTL.metaStale });
      return toMeta(item);
    },
  });
}

builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== "movie") return { meta: null };
  const videoId = numericId(id);
  if (!videoId) return { meta: null };

  try {
    return { meta: await getMeta(videoId), cacheMaxAge: 86400 };
  } catch (error) {
    warn(`meta ${id} failed: ${error.message}`);
    return { meta: null };
  }
});

// ---------------------------------------------------------------------------
// Embed page parsing -> direct MP4 streams
// ---------------------------------------------------------------------------
function extractCfg(html) {
  const marker = html.indexOf("var CFG");
  if (marker === -1) throw new Error("CFG block not found in embed page");

  const equals = html.indexOf("=", marker);
  const start = html.indexOf("{", equals);
  if (start === -1) throw new Error("CFG object not found in embed page");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(html.slice(start, index + 1));
      }
    }
  }

  throw new Error("CFG object is unterminated");
}

async function fetchEmbedPage(videoId) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cacheBuster = `${Date.now()}${attempt}`;
    const url = `${PORNAPI_EMBED_BASE}/?vl_embed=${encodeURIComponent(videoId)}&_cb=${cacheBuster}`;
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
        redirect: "follow",
      });
      if (!response.ok) throw new Error(`embed page ${response.status}`);
      const html = await response.text();
      if (!html) throw new Error("embed page was empty");
      return html;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`embed fetch failed: ${lastError ? lastError.message : "unknown error"}`);
}

async function probeStream(url, deadline) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (Date.now() > deadline) break;
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Range: "bytes=0-1" },
        signal: AbortSignal.timeout(2500),
      });
      const contentRange = response.headers.get("content-range") || "";
      const sizeMatch = /\/(\d+)\s*$/.exec(contentRange);
      const contentType = response.headers.get("content-type") || "";
      const ok = response.status === 206 || (response.status === 200 && /video\//i.test(contentType));
      if (response.body) {
        try {
          await response.body.cancel();
        } catch {
          /* the connection is already gone */
        }
      }
      if (ok) return { ok: true, size: sizeMatch ? Number(sizeMatch[1]) : null };
    } catch {
      /* transient CDN error, try again */
    }
  }
  return { ok: false, size: null };
}

async function buildStreams(cfg, videoId) {
  const sources = cfg && cfg.sources && typeof cfg.sources === "object" ? cfg.sources : {};
  const duration = formatRuntime(cfg && cfg.duration);
  const candidates = [];
  const seen = new Set();

  const qualities = Object.keys(sources)
    .filter((quality) => Array.isArray(sources[quality]) && sources[quality].length)
    .sort((a, b) => qualityRank(b) - qualityRank(a));

  for (const quality of qualities) {
    for (const source of sources[quality]) {
      const url = source && typeof source.d === "string" ? source.d : "";
      // The API's CDN is HTTPS-only; ignore anything else.
      if (!/^https:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);

      candidates.push({
        quality,
        url,
        name: `Pimp Bunny ${qualityLabel(quality)}`,
        title: [duration, cfg.title].filter(Boolean).join(" · "),
        filename: safeFilename(cfg.title, quality),
      });
      break; // one mirror per quality is enough
    }
  }

  if (!candidates.length) throw new Error(`no playable sources for video ${videoId}`);

  // The CDN occasionally answers the first byte-range request with a transient
  // 502. Probe each quality once and put reachable ones first so the default
  // pick is the most likely to play; unreachable ones stay as fallbacks.
  const deadline = Date.now() + 5500;
  const probes = await Promise.all(candidates.map((candidate) => probeStream(candidate.url, deadline)));
  const ordered = candidates.map((candidate, index) => ({ ...candidate, ...probes[index] }));
  const reachable = probes.filter((probe) => probe.ok).length;

  ordered.sort((a, b) => Number(b.ok) - Number(a.ok));

  log(`stream ${videoId} -> ${ordered.length} qualities, ${reachable} reachable`);
  return ordered.map((stream) => ({
    name: stream.name,
    title: stream.title,
    url: stream.url,
    behaviorHints: {
      filename: stream.filename,
      ...(stream.size ? { videoSize: stream.size } : {}),
    },
  }));
}

function getStreams(videoId) {
  return cached(`stream:${videoId}`, {
    ttl: TTL.stream,
    stale: TTL.streamStale,
    loader: async () => {
      const html = await fetchEmbedPage(videoId);
      const cfg = extractCfg(html);
      return buildStreams(cfg, videoId);
    },
  });
}

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "movie") return { streams: [] };
  const videoId = numericId(id);
  if (!videoId) return { streams: [] };

  try {
    return { streams: await getStreams(videoId), cacheMaxAge: 7200 };
  } catch (error) {
    warn(`stream ${id} failed: ${error.message}`);
    return { streams: [] };
  }
});

// ---------------------------------------------------------------------------
// Diagnostics exposed to server.js
// ---------------------------------------------------------------------------
function cacheStats() {
  const now = Date.now();
  let fresh = 0;
  let stale = 0;
  for (const entry of cache.values()) {
    if (now < entry.freshUntil) fresh += 1;
    else if (now < entry.staleUntil) stale += 1;
  }
  return {
    entries: cache.size,
    fresh,
    stale,
    inflight: inflight.size,
    maxEntries: MAX_CACHE_ENTRIES,
  };
}

function stats() {
  return {
    configured: Boolean(PORNAPI_KEY),
    base: PORNAPI_BASE,
    rateLimit: { ...rateLimit },
    blockedForSeconds:
      blockedUntil > Date.now() ? Math.ceil((blockedUntil - Date.now()) / 1000) : 0,
    lastApiError,
    cache: cacheStats(),
  };
}

async function health() {
  const result = {
    upstream: { ok: false, totalVideos: null, lastUpdated: null, error: null },
    api: stats(),
  };
  try {
    const data = await getApi("/stats", {}, { ttl: TTL.stats, stale: TTL.stats });
    result.upstream.ok = true;
    result.upstream.totalVideos = data.total_videos ?? null;
    result.upstream.lastUpdated = data.last_updated ?? null;
  } catch (error) {
    result.upstream.error = error.message;
  }
  return result;
}

const addonInterface = builder.getInterface();
addonInterface.stats = stats;
addonInterface.health = health;
addonInterface.getMeta = getMeta;
addonInterface.getStreams = getStreams;

module.exports = addonInterface;
