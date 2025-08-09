// Simple in-memory cache with fresh + stale windows (ephemeral per serverless instance)
// Entry lifecycle: valid (fresh) until expiresAt; still usable (stale) until staleUntil.

const store = new Map()

export function makeKey(parts) {
  return parts.filter(Boolean).join('|')
}

export function setCache(key, payload, ttlSeconds = 90, staleExtraSeconds = 600) {
  const now = Date.now()
  store.set(key, {
    data: payload,
    expiresAt: now + ttlSeconds * 1000,
    staleUntil: now + (ttlSeconds + staleExtraSeconds) * 1000,
  })
}

export function getFresh(key) {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() < entry.expiresAt) return entry.data
  return null
}

export function getStale(key) {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() < entry.staleUntil) return entry.data
  return null
}

export function cacheInfo(key) {
  const entry = store.get(key)
  if (!entry) return null
  return {
    freshForMs: Math.max(0, entry.expiresAt - Date.now()),
    staleForMs: Math.max(0, entry.staleUntil - Date.now()),
  }
}

export function purgeExpired() {
  const now = Date.now()
  for (const [k, v] of store.entries()) {
    if (now > v.staleUntil) store.delete(k)
  }
}
