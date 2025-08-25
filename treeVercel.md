# Vercel Proxy Project Tree

```
vercel-proxy/
├─ api/
│  ├─ _cache.js
│  ├─ _inflight.js
│  ├─ _normalize.js
│  ├─ _providers.js
│  ├─ _shared.js
│  ├─ _stats.js
│  ├─ category/
│  │  └─ [slug].js
│  ├─ pk/
│  │  ├─ category/
│  │  │  └─ [slug].js
│  │  └─ source/
│  │     └─ [slug].js
│  ├─ pk.js
│  ├─ search.js
│  ├─ stats.js
│  ├─ top.js
│  ├─ world/
│  │  ├─ category/
│  │  │  └─ [slug].js
│  │  └─ source/
│  │     └─ [slug].js
│  └─ world.js
├─ client/
│  └─ tribune-api.js
├─ public/
│  └─ privacy-policy.html
├─ tests/
│  └─ normalize.test.mjs
├─ .env.local
├─ .eslintrc.json
├─ .git/
├─ .gitignore
├─ .prettierrc.json
├─ .vercel/
├─ index.html
├─ newsapi.txt
├─ package.json
├─ README.md
└─ vercel.json
```

Notes:

- All non-/api/\* routes are routed to `index.html` via `vercel.json`.
- API Node functions live under `api/**`; Vercel builds them with `@vercel/node`.
- Tests use Node’s test runner (`node --test`).

## Quick API links

- Top feeds

  - https://tribune-server.vercel.app/api/world?page=1&pageSize=20
  - https://tribune-server.vercel.app/api/pk?page=1&pageSize=20
  - https://tribune-server.vercel.app/api/top

- World categories

  - https://tribune-server.vercel.app/api/world/category/business
  - https://tribune-server.vercel.app/api/world/category/technology
  - https://tribune-server.vercel.app/api/world/category/sports
  - https://tribune-server.vercel.app/api/world/category/science
  - https://tribune-server.vercel.app/api/world/category/health
  - https://tribune-server.vercel.app/api/world/category/entertainment
  - https://tribune-server.vercel.app/api/world/category/general

- Pakistan categories

  - https://tribune-server.vercel.app/api/pk/category/business
  - https://tribune-server.vercel.app/api/pk/category/technology
  - https://tribune-server.vercel.app/api/pk/category/sports
  - https://tribune-server.vercel.app/api/pk/category/science
  - https://tribune-server.vercel.app/api/pk/category/health
  - https://tribune-server.vercel.app/api/pk/category/entertainment
  - https://tribune-server.vercel.app/api/pk/category/general

- World sources (examples)

  - CNN: https://tribune-server.vercel.app/api/world/source/cnn?name=CNN&domain=cnn.com
  - Reuters: https://tribune-server.vercel.app/api/world/source/reuters?name=Reuters&domain=reuters.com
  - AP: https://tribune-server.vercel.app/api/world/source/ap?name=Associated%20Press&domain=apnews.com
  - BBC: https://tribune-server.vercel.app/api/world/source/bbc-news?name=BBC%20News&domain=bbc.com
  - The Guardian: https://tribune-server.vercel.app/api/world/source/the-guardian?name=The%20Guardian&domain=theguardian.com

- Pakistan sources (examples)

  - Dawn: https://tribune-server.vercel.app/api/pk/source/dawn?name=Dawn&domain=dawn.com
  - Geo News: https://tribune-server.vercel.app/api/pk/source/geo-news?name=Geo%20News&domain=geo.tv
  - Express Tribune: https://tribune-server.vercel.app/api/pk/source/express-tribune?name=Express%20Tribune&domain=tribune.com.pk
  - The News: https://tribune-server.vercel.app/api/pk/source/the-news?name=The%20News&domain=thenews.com.pk

- Search

  - https://tribune-server.vercel.app/api/search?q=pakistan&page=1&pageSize=20

- Stats
  - https://tribune-server.vercel.app/api/stats

Tip: append `&debug=1&nocache=1` to any URL while testing to see provider attempts and bypass cache.
