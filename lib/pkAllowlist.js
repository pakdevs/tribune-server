// PK allowlist loader: prefers Upstash Redis (if configured) or Vercel KV, falls back to bundled seed.
// Caches in-memory for a short TTL.
import { kv } from '@vercel/kv'
import { Redis } from '@upstash/redis'

const TTL_MS = 10 * 60 * 1000 // 10 minutes
const GLOBAL_KEY = '__pk_allowlist_cache__'

// Minimal seed of well-known Pakistani outlets that do not use .pk TLDs
// Note: From user-provided list, we only include non-.pk domains (others already
// match via the .pk rule and don't need allowlisting):
// - Added: pakobserver.net (Pakistan Observer), thefrontierpost.com (The Frontier Post)
const SEED = [
  'dawn.com',
  'geo.tv',
  'samaa.tv',
  'arynews.tv',
  'bolnews.com',
  'dunyanews.tv',
  'brecorder.com',
  'thefridaytimes.com',
  'pakobserver.net',
  'thefrontierpost.com',
  'dailythepatriot.com',
]

// .pk TLD outlets (auto-included by PK scope; listed here for reference only)
// - thenews.com.pk        (The News International)
// - tribune.com.pk        (The Express Tribune)
// - nation.com.pk         (The Nation)
// - pakistantoday.com.pk  (Pakistan Today)
// - dailytimes.com.pk     (Daily Times)
// - arabnews.pk           (Arab News Pakistan)

function normalizeHost(h = '') {
  return String(h)
    .toLowerCase()
    .replace(/^www\./, '')
}

function getUpstashClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL_KV
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN_KV
  if (url && token) return new Redis({ url, token })
  return null
}

async function readAllowlistFromStore() {
  // Prefer Upstash if creds present; else KV
  const up = getUpstashClient()
  if (up) {
    try {
      const v = await up.get('pk:allowlist')
      if (v) {
        // Upstash returns string or parsed JSON depending on client; normalize to array
        let arr = null
        if (Array.isArray(v)) arr = v
        else if (typeof v === 'string') {
          try {
            const parsed = JSON.parse(v)
            if (Array.isArray(parsed)) arr = parsed
          } catch {}
        }
        if (arr) return { list: arr, source: 'upstash' }
      }
    } catch {}
  }
  // Try Vercel KV
  try {
    const val = await kv.get('pk:allowlist')
    if (Array.isArray(val)) return { list: val, source: 'kv' }
  } catch {}
  return { list: null, source: 'seed' }
}

export async function getPkAllowlistMeta() {
  try {
    const g = globalThis[GLOBAL_KEY] || { ts: 0, list: null, source: 'seed' }
    const now = Date.now()
    if (g.list && now - g.ts < TTL_MS) return { list: g.list, source: g.source }
    // Try stores
    const store = await readAllowlistFromStore()
    let list = store.list ? store.list.map(normalizeHost).filter(Boolean) : null
    let source = store.source
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

export async function savePkAllowlistToStore(list) {
  const up = getUpstashClient()
  const norm = Array.from(new Set((list || []).map(normalizeHost).filter(Boolean)))
  if (up) {
    await up.set('pk:allowlist', JSON.stringify(norm))
    return 'upstash'
  }
  await kv.set('pk:allowlist', norm)
  return 'kv'
}

export async function deletePkAllowlistFromStore() {
  const up = getUpstashClient()
  if (up) {
    try {
      await up.del('pk:allowlist')
    } catch {}
    return 'upstash'
  }
  try {
    await kv.del('pk:allowlist')
  } catch {}
  return 'kv'
}
