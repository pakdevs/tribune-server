# Pakistan Tribune News Proxy

Production-focused serverless API aggregator providing normalized news articles for the Pakistan Tribune app.

## Core Endpoints

| Purpose                         | Route                            | Notes                                                                        |
| ------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| World mixed headlines           | `GET /api/world`                 | Backed by Webz.io (country/category filters)                                 |
| Pakistan headlines              | `GET /api/pk`                    | Backed by Webz.io (country=pk; supports domain/source filters)               |
| World category                  | `GET /api/world/category/{slug}` | Slugs: business, entertainment, general, health, science, sports, technology |
| Pakistan category               | `GET /api/pk/category/{slug}`    | Same slug set; fallback logic applies                                        |
| US Top (legacy single provider) | `GET /api/top`                   | Deprecated                                                                   |
| Search (global)                 | `GET /api/search?q=term`         | Backed by Webz.io (domain/source filters supported)                          |
| Provider stats (ephemeral)      | `GET /api/stats`                 | In-memory counts (resets on cold start)                                      |
| Trending topics (new)           | `GET /api/trending/topics`       | Returns `{ region, asOf, topics[] }` (KV/in-memory cached)                   |
| About Pakistan (wrapper)        | `GET /api/feeds/about-pakistan`  | Same as `/api/pk?scope=about` with clearer path                              |

All successful responses: `{ items: Article[] }` (empty array if no matches). Errors: `{ error: string, message? }`.

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

`WEBZ_API`

Local development: create a `.env` file in this folder with:

```
WEBZ_API=your_webz_api_key_here
```

The server loads it automatically via `dotenv` only in local runs.
The server uses Webz.io. Keys are never exposed to the client.

### Pakistan feed filters

PK endpoints use `country=pk` and support optional filters:

- `domains`: comma-separated hostnames (maps to Webz `site:` in query)
- `sources`: comma-separated source IDs or hostnames (mapped to `site:`)
- `q`: keyword(s) to refine results

## Provider Strategy

- Provider: Webz.io. Endpoints use `newsApiLite` or `newsApi/v3/search` with `q` expressions and optional `countries`, `category`, and `site:` filters.

## Category & Aliases

Canonical slugs: `business, entertainment, general, health, science, sports, technology`.
Aliases accepted (mapped internally): `politics, world → general`, `tech → technology`, `sci → science`, `biz → business`.

## Caching & Headers

- Cache: `s-maxage=300, stale-while-revalidate=60` (CDN layer) via `cache()` helper.
- CORS: `*` (open). Adjust in `api/_shared.js` if you need to lock to your app domain.
- Basic security headers added: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`.

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

### Observability & Resilience (Phases 7–8)

- Durable metrics rollups (hourly): `GET /api/metrics/rollup?hours=6` (Bearer `METRICS_API_TOKEN` optional)
- Cache and background stats: `GET /api/cacheMetrics` (now includes `breaker` and `budget` snapshots)
- Circuit breaker: per-provider with exponential backoff; debug header `X-Breaker-Webz` when `?debug=1`
- Budget guardrails: soft reserve to protect foreground traffic (`BUDGET_SOFT_REMAIN`)

Key envs (subset):

- `BREAKER_ENABLED`, `BREAKER_FAILURE_BURST`, `BREAKER_OPEN_MS`, `BREAKER_OPEN_MS_MAX`
- `WEBZ_DAILY_LIMIT`, `WEBZ_CALL_COST`, `BUDGET_SOFT_REMAIN`
- `METRICS_API_TOKEN` (read), `METRICS_PUSH_URL`/`METRICS_PUSH_TOKEN` (optional push)

See `app/docs/server/implemented.md` → Phase 7 & 8 for full details.

### Background Revalidation (Phase 4)

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

Structured log sample (every ~5m or 2000 lookups):

```json
{
  "level": "info",
  "msg": "cache-metrics",
  "cache": {
    "puts": 1234,
    "hitsFresh": 1100,
    "revalScheduled": 42,
    "revalSuccess": 40,
    "revalFail": 2,
    "adaptiveHot": 8,
    "adaptiveCold": 5,
    "adaptiveBaseline": 20,
    "adaptiveSuppressed": 12,
    "metricsPushOk": 3,
    "metricsPushFail": 0,
    "metricsPushSuccessRatio": 1,
    "adaptiveHotSample": [
      { "key": "world|page=1", "emaHPM": 52.3 },
      { "key": "pk|scope=about", "emaHPM": 37.1 }
    ]
  }
}
```

Additional log fields:

| Field                    | Meaning                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| adaptiveHot / Cold / ... | Cumulative adaptive classification counters since cold start      |
| metricsPushOk            | Successful external metrics POST attempts                         |
| metricsPushFail          | Failed external metrics POST attempts                             |
| metricsPushSuccessRatio  | ok / (ok + fail) (0 if no attempts yet)                           |
| adaptiveHotSample        | Up to 3 hottest keys (key + EMA hits-per-minute) for quick triage |

Interpretation Tips:

- Adaptive Revalidation (Phase 4+ Enhancement)

Adaptive mode tunes background refresh urgency per key based on recent hit frequency (EMA of hits-per-minute):

Env Vars:

| Var                          | Default | Description                                                  |
| ---------------------------- | ------- | ------------------------------------------------------------ |
| ADAPTIVE_REVAL_ENABLED       | 1       | Master switch for adaptive adjustments                       |
| ADAPTIVE_MAX_KEYS            | 200     | Max tracked hot keys (older evicted)                         |
| ADAPTIVE_EMA_ALPHA           | 0.2     | EMA smoothing factor (higher = more reactive)                |
| ADAPTIVE_HOT_HPM             | 30      | HPM threshold to treat key as hot                            |
| ADAPTIVE_COLD_HPM            | 2       | HPM threshold considered cold (below this reduces threshold) |
| ADAPTIVE_HOT_FACTOR          | 2.0     | Multiplier applied to base threshold for hot keys            |
| ADAPTIVE_COLD_FACTOR         | 0.5     | Multiplier for cold keys                                     |
| ADAPTIVE_MIN_HPM_TO_SCHEDULE | 0.2     | Below this HPM, scheduling is suppressed                     |

Endpoint: `GET /api/cacheMetrics` (returns cache, revalidation, adaptive samples). Protect with `METRICS_API_TOKEN` (Bearer) if set.

External Push (optional):

| Var                | Description                                                 |
| ------------------ | ----------------------------------------------------------- |
| METRICS_PUSH_URL   | HTTP(S) collector URL to POST periodic `cache-metrics` JSON |
| METRICS_PUSH_TOKEN | Optional bearer token for push authorization                |

Push payload sample:

```json
{
  "ts": "2025-09-16T00:00:00.000Z",
  "cache": {
    "puts": 123,
    "hitsFresh": 110,
    "l2": { "hits": 20, "misses": 5 },
    "reval": { "scheduled": 40 }
  }
}
```

Operational Guidelines:

- Increase `ADAPTIVE_HOT_FACTOR` cautiously; high values can front-load upstream usage.
- If many keys show low HPM and are suppressed, confirm clients aren’t churning random query params (key hygiene).
- For bursty traffic, raise `ADAPTIVE_EMA_ALPHA` for quicker reaction; lower it for stability.
- Monitor `revalScheduled` vs `revalSuccess` after tuning adaptive thresholds to ensure error rates don’t spike.

- High `revalScheduled` with low `revalSuccess` → increase `BG_MIN_INTERVAL_MS` or investigate upstream errors.
- Many `skippedMaxConcurrent` → raise `BG_MAX_INFLIGHT` cautiously (consider upstream rate limits).
- Large `skippedFresh` relative to hits → threshold too high; lower `BG_REVALIDATE_FRESH_THRESHOLD_MS` for earlier refresh.
- If `revalFail` spikes, rely on stale window while debugging upstream provider health.
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
- Vercel KV (optional): If `@vercel/kv` is installed and env configured, trending topics will read/write a `topics:pk:latest` key for cross‑instance consistency.

## Future Enhancements (Not Yet Implemented)

- Durable provider usage metrics (Redis / KV).
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

### Observability (Phase 1 Implemented)

Per-response headers:

- `X-Provider`: provider that returned articles.
- `X-Provider-Attempts`: ordered list of attempted providers.
- `X-Provider-Articles`: number of normalized articles.

Ephemeral usage summary: `GET /api/stats`.

## App Metrics Dashboard

The mobile app includes a simple metrics dashboard screen (`app/app/metrics.tsx`) that consumes `/api/cacheMetrics` and `/api/metrics/rollup`. Configure:

- `EXPO_PUBLIC_SERVER_BASE` – your deployed server URL
- `EXPO_PUBLIC_METRICS_TOKEN` – optional bearer token for metrics endpoints

This screen is not linked by default; you can add a dev-only entry point in Settings.

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
