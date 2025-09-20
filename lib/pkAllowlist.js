// PK allowlist loader: prefers Upstash Redis (if configured) or Vercel KV, falls back to bundled seed.
// Caches in-memory for a short TTL.
// Using only the built-in SEED; no external KV/Upstash usage.

// Allowlist storage: prefer Vercel KV; otherwise fall back to bundled seed list.

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

async function readAllowlistFromStore() {
  // Seed-only mode: no external lookups
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
  // No-op in seed-only mode
  return 'seed'
}

export async function deletePkAllowlistFromStore() {
  // No-op in seed-only mode
  return 'seed'
}
