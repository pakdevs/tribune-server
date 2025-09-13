## Server: main architecture (Vercel serverless + Webz.io)

High-level layout of the `tribune-server` workspace. Omitted: node_modules, .git.

The-Pakistan-Tribune/tribune-server
├─ vercel.json
├─ tsconfig.json
├─ package.json
├─ README.md
├─ index.html ← docs with example API links
├─ api/ ← serverless API routes
│ ├─ \_env.ts ← env helpers (uses WEBZ_API)
│ ├─ \_providers.ts ← provider builder + retry variants
│ ├─ \_normalize.ts ← normalize upstream items
│ ├─ \_shared.ts ← common helpers
│ ├─ \_cooldown.ts ← 429 cooldown gate
│ ├─ \_inflight.ts ← dedupe in-flight requests
│ ├─ \_stats.ts ← request stats aggregation
│ ├─ \_cache.ts ← micro cache (if enabled)
│ ├─ world.ts ← world top feed
│ ├─ pk.ts ← Pakistan top feed (country=pk)
│ ├─ search.ts ← keyword/domain-date search
│ ├─ stats.ts ← server stats
│ ├─ top.ts ← region-agnostic top feed
│ ├─ world/
│ │ ├─ category/
│ │ │ └─ [slug].ts ← world by category
│ │ └─ source/
│ │ └─ [slug].ts ← single source (name/slug → source_id, no domain)
│ └─ pk/
│ ├─ \_domains.ts ← placeholder; domain filtering removed
│ ├─ category/
│ │ └─ [slug].ts ← Pakistan by category
│ └─ source/
│ └─ [slug].ts ← Pakistan single source (name/slug)
├─ client/
│ └─ tribune-api.ts ← tiny client wrapper used by app
├─ public/
│ └─ privacy-policy.html
├─ tests/
│ └─ normalize.test.mjs
└─ types/
└─ ambient.d.ts

Notes

- Single provider: Webz.io News API (Lite or v3) with WEBZ_API.
- Page size capped/defaulted to 10; public keys omit page_size.
- Source endpoints prefer domain-based filtering via site: and optional name slug matching.
- Robust fallback variants handle 422s and plan limits.
  ...
