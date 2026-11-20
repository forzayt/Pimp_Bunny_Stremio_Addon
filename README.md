# Pimp Bunny Stremio Addon

A Stremio addon for the [PornAPI](https://pornapi.sbs) catalogue. Pimp Bunny brings a large, curated collection to
one reliable Stremio experience — browse, search and stream favourites directly in the player with no browser redirects or video proxying.

Built with the [Stremio Addon SDK](https://github.com/Stremio/stremio-addon-sdk) and Express.

## Features

- **12 catalogs**: New Releases, Most Viewed, 4K Ultra HD, Search, Tags, Studios, Networks, and curated Anal, MILF, Amateur, Lesbian and POV collections.
- **Filters**: each tag/studio/network catalogue exposes a picker with the most popular entries.
- **Search**: dedicated search catalog (required query) across the whole catalogue.
- **Meta**: title, poster/background, description, release year, runtime, tags, cast and studio.
- **Streams**: one direct MP4 stream per available quality (4K, 720p, 480p, …), seekable and
  playable natively in Stremio on desktop, mobile and TV.
- **Cache-first**: catalog, metadata, and search lookups are cached for seven days; stream URLs
  remain cached for two hours so playback links stay fresh. Stale-on-error fallback further reduces upstream traffic.
- **No bandwidth cost**: video bytes go straight from PornAPI's CDN to the player; this server
  only returns metadata and URLs.

## Quick start

```bash
npm install
PORNAPI_KEY=your-key npm start
# windows: $env:PORNAPI_KEY="your-key"; npm start
```

The addon listens on `http://localhost:7000`; the manifest is at
`http://localhost:7000/manifest.json`.

On Node 20.6+ you can put the key in `.env` (copy `.env.example`) and run `npm run start:env`.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORNAPI_KEY` | — | PornAPI key, sent as `X-VL-Key`. Required for production. |
| `PORNAPI_BASE` | `https://pornapi.sbs/wp-json/video-library/v1` | REST API base URL. |
| `PORNAPI_EMBED_BASE` | `https://pornapi.sbs` | Base for the `?vl_embed=` player page. |
| `HOST_URL` | `RENDER_EXTERNAL_URL` or `http://localhost:PORT` | Public URL used on the landing page. |
| `PORT` | `7000` | HTTP port. |

## Deploy (Render)

1. Point the Render service at this repository (build: `npm install`, start: `npm start`).
2. Add `PORNAPI_KEY` under **Environment**.
3. Keep `HOST_URL` unset; Render's `RENDER_EXTERNAL_URL` is picked up automatically.

## Install in Stremio

1. Stremio → **Addons** → **My addons** → **Install community addon**.
2. Paste `https://your-addon.example.com/manifest.json`.
3. Open the **Pimp Bunny** addon and pick a catalog.

> The addon id is `org.pimpbunny.addon`. If you still have an earlier install
> installed, uninstall it once and install this manifest.

## Endpoints

| Route | Description |
| --- | --- |
| `GET /manifest.json` | Stremio addon manifest. |
| `GET /catalog/movie/:id.json` | Catalog pages (`skip`, `genre`, `search` extras). |
| `GET /meta/movie/pvl:ID.json` | Video metadata. |
| `GET /stream/movie/pvl:ID.json` | Direct MP4 streams. |
| `GET /health` | Upstream reachability, rate-limit headers and cache stats. |
| `GET /debug/video/ID` | Resolved meta + streams for a video (debugging). |

## How the platform works

Pimp Bunny is an **indexing and integration layer**, not a video host. Its purpose is to teach
how a Stremio addon can connect a catalogue provider to the Stremio platform while keeping media
delivery separate from the addon's own server.

### Network request flow

```text
Stremio client
    │  catalog, metadata, and stream requests
    ▼
Pimp Bunny / Express server
    │  cached REST and embed lookups
    ▼
PornAPI API and embed page
    │  metadata and time-limited direct media URLs
    ▼
PornAPI CDN ─────────────────────────────────────────► Stremio player
                 video bytes go directly to the player
```

The addon server handles the control plane: it returns catalogue items, metadata, and direct
stream URLs. The video data does **not** pass through this server. Once Stremio receives a media
URL, the player downloads it from the upstream provider's CDN.

### What happens when someone uses the addon

1. **Install and discovery** — Stremio downloads `/manifest.json`. The manifest identifies the
   addon, its catalogues, supported media type, and the available `catalog`, `meta`, and `stream`
   resources.
2. **Browse or search** — Stremio requests a catalogue route. Pimp Bunny calls PornAPI's
   `/videos` or `/search` endpoint, maps the returned records into Stremio's `meta` format, and
   returns posters, titles, descriptions, tags, and other preview information.
3. **Open a title** — Stremio requests its metadata route. The addon first reuses the catalogue
   record it already saved; only a cache miss requires an upstream `/videos/{id}` request.
4. **Press play** — Stremio requests the stream route. The addon reads the upstream embed page,
   extracts the available quality URLs, and sends those URLs back as stream choices. Stremio then
   plays the selected URL directly from the upstream CDN.

### Reliability and caching

- **Catalogues and searches** are cached for seven days and can use a seven-day stale fallback if
  the upstream service is temporarily unavailable.
- **Metadata** is cached for seven days and can be served stale for up to 30 days during an
  upstream outage.
- **Stream URLs** are cached for two hours even though their upstream tokens typically last longer;
  this refreshes links before they are likely to expire.
- **Rate limiting** is observed through `x-ratelimit-*` headers. When the upstream returns `429`,
  the addon backs off and can continue serving eligible cached data.

This arrangement lowers upstream traffic, improves repeat-request latency, and avoids proxying
large video files through the addon's infrastructure.

### Platform responsibilities

| Component | Responsibility |
| --- | --- |
| Stremio | Displays catalogues, presents metadata, and plays the selected stream. |
| Pimp Bunny | Translates Stremio requests into upstream lookups; caches and returns metadata and stream URLs. |
| PornAPI | Provides the catalogue data, embed information, and upstream media URLs. |
| Upstream CDN | Delivers video bytes directly to the Stremio player. |

## Content disclaimer

Pimp Bunny does not host, upload, store, distribute, or control video content. Catalogue metadata
and stream sources come from [PornAPI](https://pornapi.sbs/). Content availability, quality,
access permissions, and link lifetime are controlled by that third-party service.

## Project structure

```
package.json     # dependencies and scripts
server.js        # Express server, landing page, /health and /debug routes
addon.js         # manifest, PornAPI client, caches, catalog/meta/stream handlers
.env.example     # environment template
```

## Notes

- PornAPI is third-party: content availability, quality and link lifetime are up to them.
- Stream tokens last roughly 6 hours; the addon refreshes them automatically after ~2 hours.
- This addon does not host, distribute, or proxy video content. It indexes upstream metadata and returns stream URLs for Stremio.
- 18+ only. Unofficial project, not affiliated with PornAPI or Stremio.

## License

MIT.
