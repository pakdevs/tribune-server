#!/usr/bin/env node
/*
  Ping a set of production endpoints with small delays, to warm CDN and in-memory caches.
  Usage:
    BASE_URL=https://your-app.vercel.app node scripts/ping-warmup.mjs
  Optional env:
    PING_DELAY_MS=5000  # delay between pings
    PING_RETRIES=2      # attempts per endpoint
*/

const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '')
if (!BASE_URL) {
  console.error('BASE_URL is required (e.g., https://your-app.vercel.app)')
  process.exit(1)
}

const DELAY_MS = Number(process.env.PING_DELAY_MS || '5000')
const RETRIES = Number(process.env.PING_RETRIES || '2')

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function hit(path) {
  const url = `${BASE_URL}${path}`
  const t0 = Date.now()
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'warmup/1.0' } })
    const ms = Date.now() - t0
    const xcache = res.headers.get('x-cache') || ''
    const ra = res.headers.get('retry-after') || ''
    let body = null
    try {
      body = await res.json()
    } catch {}
    const items = Array.isArray(body?.items) ? body.items.length : undefined
    return { ok: res.ok, status: res.status, ms, xcache, retryAfter: ra, items }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

async function attempt(path) {
  for (let i = 0; i <= RETRIES; i++) {
    const r = await hit(path)
    if (r.ok || r.status === 429) return r
    await sleep(1000)
  }
}

async function main() {
  const targets = [
    '/api/world?page=1',
    '/api/pk?page=1',
    '/api/pk?scope=from&page=1',
    '/api/pk?scope=about&page=1',
    '/api/trending/topics?region=pk',
  ]
  console.log(`Warming: ${BASE_URL}`)
  for (const path of targets) {
    const r = await attempt(path)
    if (!r) {
      console.log(`- ${path} -> no response`)
    } else if (r.ok) {
      console.log(
        `- ${path} -> ${r.status} in ${r.ms}ms, items=${r.items ?? '—'}, cache=${r.xcache || '—'}`
      )
    } else if (r.status === 429) {
      console.log(`- ${path} -> 429 (rate limited) retryAfter=${r.retryAfter || '—'}`)
    } else {
      console.log(`- ${path} -> ${r.status || r.error}`)
    }
    await sleep(DELAY_MS)
  }
}

main().catch((e) => {
  console.error('Warm-up failed:', e)
  process.exit(1)
})
