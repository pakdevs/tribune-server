# Pakistan Tribune News Proxy

abhi test
dosra test
3rd

Production-focused serverless API aggregator providing normalized news articles for the Pakistan Tribune app.

## Core Endpoints

| Purpose               | Route                            | Notes                                                                        |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| World mixed headlines | `GET /api/world`                 | Backed by GNews (country/category filters mapped to topics)                  |
| Pakistan headlines    | `GET /api/pk`                    | Backed by GNews (country=pk; scope=from/about; see details below)            |
| World category        | `GET /api/world/category/{slug}` | Slugs: business, entertainment, general, health, science, sports, technology |
| Pakistan category     | `GET /api/pk/category/{slug}`    | Same slug set; “All” = From ∪ About union (merge+dedupe)                     |
| Search (global)       | `GET /api/search?q=term`         | Backed by GNews Search                                                       |
| Trending topics (new) | `GET /api/trending/topics`       | Returns `{ region, asOf, topics[] }` (KV/in-memory cached)                   |

All successful responses: `{ items: Article[] }` (empty array if no matches). Errors: `{ error: string, message? }`.

Deprecated endpoints removed:

- `/api/top` → use `/api/world`
- `/api/stats` and `/api/metrics/*` (metrics subsystem removed)
- `/api/feeds/about-pakistan` → use `/api/pk?scope=about`

### Deployment mapping (Vercel Hobby ≤ 12 functions)

To stay within the Hobby plan function cap, we:

- Moved shared helpers out of `api/` into `lib/` so they don't generate routes.
- Added a `vercel.json` that explicitly maps only the intended routes: `world`, `pk`, `search`, `purge`, `trending/**` (and nested world/**, pk/** for categories). Legacy metrics endpoints are not deployed.
- Added a `.vercelignore` to exclude `api/_*.ts`, `api/**/_*.ts`, and deprecated endpoints from deployment.

This ensures only the required functions are built and deployed.

### Search filters

- `domains` (comma-separated): limit results to specific hostnames.
- `from`, `to` (ISO 8601): date window for Everything queries.
- `page`, `pageSize`: pagination (1..100 pageSize).

Examples:

```
/api/search?q=pakistan&domains=thenews.com.pk,geo.tv&page=1&pageSize=20
/api/search?q=economy&from=2025-09-01T00:00:00Z&to=2025-09-05T23:59:59Z
```

## Normalized Article Fields

```
{
   id, title, summary, content, author, publishDate, category,
   imageUrl, hasImage, safeImage, imageAspectRatio,
   url, link, sourceName, displaySourceName, sourceDomain,
   sourceIcon, sourceUrl, readTime, tags[], isBreaking, likes, shares
}
```

`displaySourceName` strips TLDs for UI ("Dawn" instead of dawn.com). `sourceIcon` is a 64px favicon URL.

## Environment Variables

Set only in Vercel (never commit keys):

`GNEWS_API` (required)

Local development: create a `.env` file in this folder with:

```
GNEWS_API=your_gnews_api_key_here
```

The server loads it automatically via `dotenv` only in local runs.
Keys are never exposed to the client.

Storage integrations (optional):

- Rollups and trending persistence can use either Vercel KV (via the Vercel Marketplace Storage integration) or Upstash Redis.
- If KV/Redis envs are not configured, rollups and trending fall back to in-memory storage so endpoints continue to work (durability is reduced across cold starts).

### Pakistan feed filters

PK endpoints use `country=pk` and support optional filters:

- `domains`: comma-separated hostnames (enforced locally after normalization)
- `sources`: comma-separated source IDs/hostnames (enforced locally)
- `q`: keyword(s) to refine results

## Provider Strategy

- Single provider: GNews. Endpoints use `top-headlines` (with `country` and derived `topic` from category) and `/search` for query-driven flows.
- Domain/source filters are not supported upstream by GNews; we enforce them locally after normalization when provided.

### Pakistan scopes

- `scope=from` (default):

  - Country pinned to PK (`country=pk` or `site.country:PK`).
  - Results filtered to PK-origin sources only.
  - Uses GNews top-headlines (`country=pk`).

- `scope=about` (foreign coverage about Pakistan):
  - Always uses GNews Search (global, no `country` parameter) with an expanded OR keyword expression built from a curated list of Pakistan terms (cities, regions, finance, politics, security).
  - Post-normalization, PK-origin sources are excluded so the feed shows only foreign coverage about Pakistan.
  - Expression example (truncated): `(pakistan OR "imran khan" OR karachi OR lahore OR "state bank" OR imf ...)`.
  - A length guard trims the tail of the term list if the encoded query would exceed ~1700 characters (keeps URLs safely <2KB).
  - Headers still surface provider attempts in `X-Provider-Attempts` and `X-Provider-Attempts-Detail` (enable `?debug=1`).
  - The former `about-all` canonical cache layer was removed; each category about request is cached directly under its own key.

### Pakistan category union (All = From ∪ About)

For Pakistan categories, the “All” scope is a composite union of:

- From: top-headlines for category with country=pk (PK-origin sources)
- About: global search for category combined with the Pakistan OR-term expression (foreign coverage about PK)

On cold fetch, both requests run in parallel, results are merged and de-duplicated by article identity, and cached under the union key. On cached paths where union may be sparse, cached about results may be merged to ensure coverage. This avoids requiring users to click the “About” tab to see foreign coverage.

Optional behaviors (flags):

- `PK_SOFT_429=1`
  - When upstream returns 429 and there is no stale cache, the server responds with `200 { items: [], rateLimited: true }` and header `X-Soft-429: 1` instead of a hard 429. This prevents hard failures in the UI during temporary rate-limit windows. Respect `Retry-After` when present.

## Category & Aliases

Canonical slugs: `business, entertainment, general, health, science, sports, technology`.
Aliases accepted (mapped internally): `politics, world → general`, `tech → technology`, `sci → science`, `biz → business`.

## Caching & Headers

- Cache: `s-maxage=300, stale-while-revalidate=60` (CDN layer) via `cache()` helper.
- CORS: `*` (open). Adjust in `lib/_shared.ts` if you need to lock to your app domain.
- Basic security headers added: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`.

Additional debug/diagnostic headers:

- `X-Cache-Tier`: unified cache tier indicator (replaces legacy `X-Cache-L2`)
- `X-Provider`, `X-Provider-Attempts`, `X-Provider-Articles`: basic provider observability (enable with `?debug=1`)

### HTTP Entity Validation (Phase 6)

Phase 6 introduces conditional GET to reduce bandwidth and latency when data has not changed.

Implemented:

- Weak ETag generation (hash of item count + newest publish timestamp + ordered ids)
- Last-Modified (UTC of newest article `publishDate`)
- Conditional evaluation order: `If-None-Match` (ETag) first, then `If-Modified-Since`
- 304 responses on cache HIT when entity unchanged (skips body payload)
- Metadata persisted alongside cached payload (`__etag`, `__lm`) so subsequent hits avoid recompute

Headers now included on eligible responses:

| Header        | Example                                                            | Notes                                                  |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| ETag          | W/"ab12cd34"                                                       | Weak validator stable while item set & order unchanged |
| Last-Modified | Tue, 16 Sep 2025 10:20 GMT                                         | Newest article timestamp (fallback: response time)     |
| Cache-Control | public, max-age=30, stale-while-revalidate=60 (or existing policy) | CDN hints; unchanged from prior phases                 |

Client usage example:

```http
GET /api/world HTTP/1.1
If-None-Match: W/"ab12cd34"
```

If unchanged → `304 Not Modified` with ETag & Last-Modified only.

Rationale:

- Saves bandwidth for frequent refresh polling (mobile pull-to-refresh)
- Aligns with CDN revalidation semantics (ETag assists surrogate caches)
- Weak ETag avoids excessive recalculation while still preventing stale UIs

Advanced configuration (heuristics):

| Env Var                     | Default          | Mode(s) | Description                                                                                     |
| --------------------------- | ---------------- | ------- | ----------------------------------------------------------------------------------------------- |
| ETAG_MODE                   | weak             | both    | weak (W/ prefixed) or strong (content-sensitive)                                                |
| ETAG_SORT                   | weak:0, strong:1 | both    | When 1, items sorted (publishDate desc then id) to make ETag invariant to ordering noise        |
| ETAG_ID_SAMPLE              | (empty)          | both    | If set to integer N, only first N items contribute to id/title basis (caps cost on large feeds) |
| ETAG_STRONG_INCLUDE_SUMMARY | 0                | strong  | When 1, include summary hash in strong ETag basis (higher sensitivity)                          |

Strong mode basis parts: `id:timestamp:hash(title[:120])[:hash(summary[:200])]` (sampled & sorted if configured).

Operational guidance:

- Keep `ETAG_MODE=weak` for maximum 304 hit rates unless clients rely on rapid title edits.
- Enable `ETAG_SORT=1` (already implicit in strong) if feeds can reorder frequently without semantic changes.
- Use `ETAG_ID_SAMPLE` (e.g. 25) for large result sets to bound compute; may slightly under-detect tail changes.
- `ETAG_STRONG_INCLUDE_SUMMARY=1` only if summaries are stable and important for cache validation (costlier + more churn risk).

Future enhancements (not yet): per-field inclusion allowlist, partial diff endpoint, per-client validator negotiation.

### Telemetry & debug

The previous custom metrics subsystem (rollups, histograms, SLOs) has been removed. Lightweight observability remains:

- Debug headers described above (`?debug=1`)
- Each cached payload persists `meta.url` (upstream provider URL) and `meta.cacheKey` to aid KV/Upstash inspections
- Background revalidation remains enabled to keep hot keys fresh (see below)

### Background Revalidation

Lightweight opportunistic background revalidation keeps hot keys fresh without adding latency to client responses.

Mechanics:

- When a request serves a cached HIT and the remaining fresh time `< BG_REVALIDATE_FRESH_THRESHOLD_MS`, the key is scheduled for refresh in the background (fire-and-forget).
- Concurrency is capped by `BG_MAX_INFLIGHT`.
- A per-key minimum interval (`BG_MIN_INTERVAL_MS`) prevents thrashing.
- Negative cache entries are never revalidated in the background (skip counts tracked).
- Metrics counters are exposed via `&debug=1` headers and periodic structured logs (`msg=cache-metrics`).

Env variables (all optional, with defaults):

| Var                              | Default | Purpose                                         |
| -------------------------------- | ------- | ----------------------------------------------- |
| ENABLE_BG_REVALIDATE             | 1       | Master switch                                   |
| BG_REVALIDATE_FRESH_THRESHOLD_MS | 15000   | Schedule if fresh TTL remaining < threshold     |
| BG_MAX_INFLIGHT                  | 3       | Max concurrent background refreshes             |
| BG_MIN_INTERVAL_MS               | 10000   | Minimum ms between successful refreshes per key |

Debug headers (when `debug=1`):

| Header                      | Meaning                                         |
| --------------------------- | ----------------------------------------------- |
| X-Reval-Scheduled           | Total background refreshes scheduled            |
| X-Reval-Success             | Successful refresh completions                  |
| X-Reval-Fail                | Failed refresh attempts                         |
| X-Reval-Inflight            | Currently in-flight background tasks            |
| X-Reval-Skipped-Fresh       | Skipped because plenty of fresh time remains    |
| X-Reval-Skipped-Recent      | Skipped due to per-key min interval not elapsed |
| X-Reval-Skipped-Inflight    | Duplicate in-flight attempt suppressed          |
| X-Reval-Skipped-MaxConc     | Skipped because global concurrency cap reached  |
| X-Reval-Skipped-Negative    | Negative cache entries excluded                 |
| X-Reval-Adaptive-Hot        | Number of times a key classified hot this run   |
| X-Reval-Adaptive-Cold       | Number of cold classifications                  |
| X-Reval-Adaptive-Baseline   | Number of baseline classifications              |
| X-Reval-Adaptive-Suppressed | Scheduling suppressions (below min HPM)         |

Note: Former external metrics push and rollup docs were removed as those features are no longer present.

- Track `metricsPushOk` vs `metricsPushFail` (in `/api/cacheMetrics` response under `push`) to ensure external collector is healthy.

## Local Development

Minimal (no build step):

```
vercel dev
```

## Testing

Quick manual links are available at the root page (index.html). Deployed: https://tribune-server.vercel.app

Automated smoke (production by default):

```
npm run smoke

# Or specify an alternative base
$env:BASE_URL = "http://localhost:3000"; npm run smoke
```

The smoke script hits:

- /api/world?page=1
- /api/pk?page=1
- /api/pk?scope=from&page=1
- /api/pk?scope=about&page=1
- /api/trending/topics?region=pk

Notes:

- 429 (Rate limited) is expected if you bypass cache a lot; remove nocache in manual tests.
- Use `&debug=1` to inspect provider/cache headers quickly.

### Scheduling and KV (Optional)

- Cron (currently disabled): On the Hobby plan, only one daily cron is allowed. We’ve removed the 15‑minute cron from `vercel.json` during testing and rely on direct pulls with CDN caching.
- Re‑enable later: When upgrading to Pro (or if you prefer), add a 15‑minute cron back to warm `/api/trending/topics?region=pk` and any hot feeds.
- External scheduler option: You can use GitHub Actions or UptimeRobot to ping endpoints every 15 minutes for free.
- Vercel KV / Upstash Redis (optional): If storage envs are configured, trending topics will read/write a `topics:pk:latest` key for cross‑instance consistency. Rollup metrics use keys like `metrics:rollup:YYYYMMDDHH`. Without these, both features use in-memory fallback.

## Future Enhancements (Not Yet Implemented)

- Lightweight usage sampling (if needed) without re-introducing heavy metrics.
- On-demand media metadata endpoint (aspect ratio, blurhash).
- Rate limiting (middleware).
- Phase 5 (planned / now implementing): Adaptive Prefetch & Warming
  - Use small rolling sample of hottest keys (adaptive EMA) to proactively refresh just before they go stale.
  - Lightweight prefetch module maintains registry of last known fetchers per key (populated when background revalidation runs).
  - Periodic opportunistic tick (piggybacks on existing cache-metrics log cadence or explicit endpoint) evaluates keys:
    - If key fresh window remaining < PREFETCH_FRESH_THRESHOLD_MS (lower than normal revalidation threshold) AND not already scheduled, enqueue a prefetch.
    - Limits: PREFETCH_MAX_BATCH (default 3), PREFETCH_MIN_INTERVAL_MS per key, PREFETCH_GLOBAL_COOLDOWN_MS between ticks.
  - Goals: reduce user-perceived latency for hottest keys after inactivity bursts; smooth upstream usage.
  - Metrics: prefetchScheduled / prefetchSuccess / prefetchFail / prefetchSkipped\* (reasons).
  - Fail-safe: if upstream errors exceed PREFETCH_ERROR_BURST (e.g., >3 fails in last window) suspend prefetch for a cooldown.

### Observability (lightweight)

Per-response headers:

- `X-Provider`: provider that returned articles.
- `X-Provider-Attempts`: ordered list of attempted providers.
- `X-Provider-Articles`: number of normalized articles.
- `X-Cache-Tier`: indicates which cache tier served the response.

## App Debug Aids

For KV/Upstash inspection, cached payloads include `meta.url` (upstream URL) and `meta.cacheKey` alongside the item list. Use `?debug=1` to enable verbose headers during manual testing.

## Monorepo scripts (from repo root)

From the repository root (one level above this folder):

- Typecheck the Expo app:

  ```powershell
  npm run -s typecheck
  ```

- Run the server test suite:

  ```powershell
  npm run -s test
  ```

These proxy to the `app/` and `tribune-server/` package scripts respectively via the root workspace `package.json`.

## Maintenance

- Keep dependencies minimal (currently none) to ensure fast cold starts.
- Update runtime version in `vercel.json` only when needed; pinning prevents surprise breakage.

## License

Proprietary – internal project (add a license if distributing externally).

---

## Cache warm-up workflow (optional)

To gently warm CDN/in-memory caches without Vercel Cron (Hobby):

- Manual run via GitHub Actions:

  1.  Go to Actions → "Ping API warm-up"
  2.  Click "Run workflow"
  3.  Provide base_url (e.g., `https://your-app.vercel.app`) and optional delay_ms

- Local run:

  ```powershell
  cd tribune-server
  $env:BASE_URL = "https://your-app.vercel.app"
  npm run warmup
  ```

- Enable a schedule later (optional): edit `.github/workflows/ping.yml` and uncomment the `schedule` block to ping every 15 minutes.
