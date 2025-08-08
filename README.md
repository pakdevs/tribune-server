# News Proxy (Vercel)

Minimal serverless proxy for Pakistan Tribune app.

## Endpoints

- `GET /api/top`
- `GET /api/category/[slug]`
- `GET /api/search?q=term&category=slug|all`

All responses: `{ items: Article[] }` where each Article is normalized for the app.

## Setup

1. Create a project on Vercel and link this `vercel-proxy` folder.
2. Add environment variables in Project Settings → Environment Variables:
   - `NEWS_API_KEY` (and any other upstream keys)
3. Replace the example upstream URLs in `api/top.js`, `api/category/[slug].js`, and `api/search.js` with your real providers (APIs or your own RSS aggregator).
4. Deploy. Your base URL will be: `https://<project>.vercel.app/api`
5. In the mobile app, set `APP_CONFIG.api.baseUrl` to that URL.

## CORS & Caching

- CORS is open (`*`). Adjust as needed.
- Cache-Control: `s-maxage=300, stale-while-revalidate=60`.

## Notes

- Keep API keys only in Vercel env vars.
- You can extend normalization in `api/_normalize.js`.
