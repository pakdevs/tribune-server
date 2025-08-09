# Pakistan Tribune News Proxy

Production-focused serverless API aggregator providing normalized news articles for the Pakistan Tribune app.

## Core Endpoints

| Purpose                         | Route                            | Notes                                                                        |
| ------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| World mixed headlines           | `GET /api/world`                 | Multi-provider fallback                                                      |
| Pakistan headlines              | `GET /api/pk`                    | Includes NewsAPI search fallback (q=Pakistan)                                |
| World category                  | `GET /api/world/category/{slug}` | Slugs: business, entertainment, general, health, science, sports, technology |
| Pakistan category               | `GET /api/pk/category/{slug}`    | Same slug set; fallback logic applies                                        |
| US Top (legacy single provider) | `GET /api/top`                   | Direct NewsAPI top-headlines (US default)                                    |
| Search (global)                 | `GET /api/search?q=term`         | NewsAPI Everything (en)                                                      |
| Provider stats (ephemeral)      | `GET /api/stats`                 | In-memory counts (resets on cold start)                                      |

All successful responses: `{ items: Article[] }` (empty array if no matches). Errors: `{ error: string, message? }`.

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

- `NEWSAPI_ORG`
- `NEWSDATA_API`
- `WORLD_NEWS_API`
- `GNEWS_API`

Endpoints automatically adapt to whichever keys are present.

## Provider Fallback Strategy

1. Attempt higher quota / broader sources first (NewsData).
2. Try NewsAPI / WorldNews / GNews in rotating order (minute-based) to distribute load.
3. Pakistan endpoints append a final synthetic provider `newsapi_pk` performing an Everything search `q=Pakistan` if category/country sources fail.

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
