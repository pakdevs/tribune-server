# Pakistan Tribune News Proxy

Production-focused serverless API aggregator providing normalized news articles for the Pakistan Tribune app.

## Core Endpoints

| Purpose                         | Route                            | Notes                                                                        |
| ------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| World mixed headlines           | `GET /api/world`                 | Backed by NewsAPI Top Headlines                                              |
| Pakistan headlines              | `GET /api/pk`                    | Backed by NewsAPI Everything (q=Pakistan)                                    |
| World category                  | `GET /api/world/category/{slug}` | Slugs: business, entertainment, general, health, science, sports, technology |
| Pakistan category               | `GET /api/pk/category/{slug}`    | Same slug set; fallback logic applies                                        |
| US Top (legacy single provider) | `GET /api/top`                   | Deprecated                                                                   |
| Search (global)                 | `GET /api/search?q=term`         | Backed by NewsAPI Everything (domains filter supported)                      |
| Provider stats (ephemeral)      | `GET /api/stats`                 | In-memory counts (resets on cold start)                                      |

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

`NEWSAPI_ORG` (preferred) or `NEWSAPI_KEY` (legacy)

Local development: create a `.env` file in this folder with:

```
NEWSAPI_ORG=your_newsapi_key_here
```

The server loads it automatically via `dotenv` only in local runs.
The server uses NewsAPI.org. Keys are never exposed to the client.

### Pakistan feed domain scoping

NewsAPI does not support `country=pk` on Top Headlines. To keep PK feed focused on Pakistani outlets, `/api/pk` and `/api/pk/category/{slug}` default to a curated domains allowlist.

- Override/extend domains:
  - `?domains=dawn.com,tribune.com.pk` to add more.
  - `?mode=replace&domains=dawn.com,tribune.com.pk` to replace the list entirely.
- Debug header: responses include `X-PK-Domains` with the effective list.

## Provider Strategy

- Single provider: NewsAPI.org. Top headlines uses /v2/top-headlines (cannot combine sources with country/category); Search uses /v2/everything with optional `domains` and time sorting.

## Category & Aliases

Canonical slugs: `business, entertainment, general, health, science, sports, technology`.
Aliases accepted (mapped internally): `politics, world → general`, `tech → technology`, `sci → science`, `biz → business`.

## Caching & Headers

- Cache: `s-maxage=300, stale-while-revalidate=60` (CDN layer) via `cache()` helper.
- CORS: `*` (open). Adjust in `api/_shared.js` if you need to lock to your app domain.
- Basic security headers added: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`.

## Local Development

Minimal (no build step):

```
vercel dev
```

## Future Enhancements (Not Yet Implemented)

- Durable provider usage metrics (Redis / KV).
- On-demand media metadata endpoint (aspect ratio, blurhash).
- Rate limiting (middleware).

### Observability (Phase 1 Implemented)

Per-response headers:

- `X-Provider`: provider that returned articles.
- `X-Provider-Attempts`: ordered list of attempted providers.
- `X-Provider-Articles`: number of normalized articles.

Ephemeral usage summary: `GET /api/stats`.

## Maintenance

- Keep dependencies minimal (currently none) to ensure fast cold starts.
- Update runtime version in `vercel.json` only when needed; pinning prevents surprise breakage.

## License

Proprietary – internal project (add a license if distributing externally).
