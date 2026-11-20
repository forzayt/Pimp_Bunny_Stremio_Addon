# PornAPI Stremio Addon

A Stremio addon for the [PornAPI](https://pornapi.sbs) catalogue. Browse, search and stream
135,000+ videos directly in the Stremio player — no browser redirects and no video proxying.

Built with the [Stremio Addon SDK](https://github.com/Stremio/stremio-addon-sdk) and Express.

## Features

- **7 catalogs**: New Releases, Most Viewed, 4K Ultra HD, Search, Tags, Studios and Networks.
- **Filters**: each tag/studio/network catalogue exposes a picker with the most popular entries.
- **Search**: dedicated search catalog (required query) across the whole catalogue.
- **Meta**: title, poster/background, description, release year, runtime, tags, cast and studio.
- **Streams**: one direct MP4 stream per available quality (4K, 720p, 480p, …), seekable and
  playable natively in Stremio on desktop, mobile and TV.
- **Cache-first**: catalog, metadata, search and stream lookups are cached server-side with
  stale-on-error fallback, so the rate-limited PornAPI is hit as little as possible.
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
3. Open the **PornAPI** addon and pick a catalog.

> The addon id changed to `org.pornapi.addon`. If you still have the old PimpBunny addon
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

## How it works

1. **Catalog / search** → cached PornAPI `/videos` and `/search` responses, mapped to Stremio
   metas. Catalog pages are cached for 10 minutes to 3 hours depending on the catalog.
2. **Meta** → served from the catalog seed when possible, otherwise `/videos/{id}`, cached for
   24 hours (stale for 30 days).
3. **Streams** → the API only exposes an iframe, so the addon fetches the `?vl_embed=` page,
   parses its `CFG.sources` block and returns the direct `*.workers.dev/...mp4` URLs.
   URLs are cached for 2 hours (tokens live ~6 hours), so repeated plays do not reload the embed.
4. **Rate limits** → `x-ratelimit-*` headers are tracked and a `429` engages a cooldown window
   based on `Retry-After` / `x-ratelimit-reset`; cached (even slightly stale) data keeps serving
   in the meantime.

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
- This addon does not host or proxy any video. It only indexes PornAPI metadata.
- 18+ only. Unofficial project, not affiliated with PornAPI or Stremio.

## License

MIT.
