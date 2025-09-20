// PK allowlist loader: prefers KV, falls back to bundled seed. Caches in-memory for a short TTL.
import { kv } from '@vercel/kv'

const TTL_MS = 10 * 60 * 1000 // 10 minutes
const GLOBAL_KEY = '__pk_allowlist_cache__'

// Minimal seed of well-known Pakistani outlets that do not use .pk TLDs
const SEED = [
  'dawn.com',
  'geo.tv',
  'samaa.tv',
  'arynews.tv',
  'bolnews.com',
  'dunyanews.tv',
  'brecorder.com',
  'thefridaytimes.com',
]

function normalizeHost(h = '') {
  return String(h)
    .toLowerCase()
    .replace(/^www\./, '')
}

export async function getPkAllowlistMeta() {
  try {
    const g = globalThis[GLOBAL_KEY] || { ts: 0, list: null, source: 'seed' }
    const now = Date.now()
    if (g.list && now - g.ts < TTL_MS) return { list: g.list, source: g.source }
    // Try KV first
    let list = null
    let source = 'seed'
    try {
      const val = await kv.get('pk:allowlist')
      if (Array.isArray(val)) {
        list = val.map(normalizeHost).filter(Boolean)
        source = 'kv'
      }
    } catch {}
    if (!list) list = SEED.slice()
    globalThis[GLOBAL_KEY] = { ts: now, list, source }
    return { list, source }
  } catch {
    return { list: SEED.slice(), source: 'seed' }
  }
}

// Back-compat: return list only
export async function getPkAllowlist() {
  const { list } = await getPkAllowlistMeta()
  return list
}

export function isHostInAllowlist(host, allowlist) {
  const h = normalizeHost(host)
  if (!h) return false
  const set = Array.isArray(allowlist) ? new Set(allowlist) : new Set(SEED)
  return set.has(h)
}

export function invalidatePkAllowlistCache() {
  try {
    delete globalThis[GLOBAL_KEY]
  } catch {}
}
