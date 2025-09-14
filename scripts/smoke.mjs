#!/usr/bin/env node
/*
 Simple smoke test for production endpoints.
 Usage:
   BASE_URL=https://tribune-server.vercel.app node scripts/smoke.mjs
 Defaults to the Vercel prod URL if BASE_URL not set.
*/

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '') || 'https://tribune-server.vercel.app'

function withTimeout(ms) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(new Error(`Timeout after ${ms}ms`)), ms)
  return { signal: ctrl.signal, done: () => clearTimeout(id) }
}

async function hit(path) {
  const url = `${BASE_URL}${path}`
  const t = Date.now()
  const { signal, done } = withTimeout(10000)
  try {
    const res = await fetch(url, { signal, headers: { 'user-agent': 'smoke/1.0' } })
    const elapsed = Date.now() - t
    const ct = res.headers.get('content-type') || ''
    const xcache = res.headers.get('x-cache') || ''
    const provider = res.headers.get('x-provider') || ''
    const retryAfter = res.headers.get('retry-after') || ''
    let body
    if (ct.includes('application/json')) {
      body = await res.json().catch(() => ({}))
    } else {
      body = { note: `Non-JSON response (${ct})` }
    }
    const itemsLen = Array.isArray(body.items) ? body.items.length : undefined
    const info = { status: res.status, ms: elapsed, xcache, provider, retryAfter, items: itemsLen }
    return { url, ok: res.ok, info, body }
  } catch (e) {
    return { url, ok: false, error: String(e) }
  } finally {
    done()
  }
}

async function main() {
  const targets = [
    ['/api/world?page=1', 'World top'],
    ['/api/pk?page=1', 'PK top (mixed)'],
    ['/api/pk?scope=from&page=1', 'PK From'],
    ['/api/pk?scope=about&page=1', 'PK About'],
  ['/api/trending/topics?region=pk&debug=1', 'Trending topics (PK)'],
  ]
  console.log(`Base: ${BASE_URL}`)
  const results = []
  for (const [path, label] of targets) {
    const r = await hit(path)
    results.push({ label, ...r })
    if (r.ok) {
      console.log(
        `✔ ${label} — ${r.info.status} in ${r.info.ms}ms, items=${r.info.items}, cache=${
          r.info.xcache || '—'
        }`
      )
    } else {
      if (r.info && r.body && r.info.status >= 400) {
        const extra = [r.body.error, r.body.message].filter(Boolean).join(' | ')
        console.log(`✖ ${label} — ${r.info.status}${extra ? ` (${extra})` : ''}`)
      } else {
        console.log(`✖ ${label} — error: ${r.error || (r.info && r.info.status)}`)
      }
    }
  }
  // Summarize 429 separately (not a hard failure in testing)
  const hardFailures = results.filter((r) => r.ok === false)
  const rateLimited = results.filter((r) => r.info && r.info.status === 429)
  console.log('\nSummary:')
  console.log(`  OK: ${results.filter((r) => r.ok && r.info && r.info.status === 200).length}`)
  console.log(`  Rate limited (429): ${rateLimited.length}`)
  console.log(`  Failures: ${hardFailures.length}`)
  // Exit non-zero only if there are hard failures (network, 5xx without body)
  process.exit(hardFailures.length ? 1 : 0)
}

main().catch((e) => {
  console.error('Smoke failed:', e)
  process.exit(1)
})
