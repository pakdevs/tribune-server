// Load environment variables for local development. In production (Vercel),
// env vars are provided by the platform and this import is a no-op.
import 'dotenv/config'

// GNews API key (set GNEWS_API in Vercel env)
export function getGnewsApiKey(): string | undefined {
  const key = (process as any).env.GNEWS_API
  return key ? String(key) : undefined
}

// Daily request budget for GNews to preserve quota / reduce cost.
// Example: GNEWS_DAILY_LIMIT=500
export function getGnewsDailyLimit(): number {
  const v = (process as any).env.GNEWS_DAILY_LIMIT
  if (v === undefined) return 500 // reasonable default for free/paid tiers
  const n = Number(v)
  return Number.isFinite(n) ? n : 500
}

// Logical cost per GNews call. Default 1. Useful if you weigh some flows higher.
export function getGnewsCallCost(): number {
  const v = (process as any).env.GNEWS_CALL_COST
  if (v === undefined) return 1
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1
}

// Phase 8: Budget soft limit (stop prefetch/revalidate below remaining threshold)
export function getBudgetSoftRemain(): number {
  const v = (process as any).env.BUDGET_SOFT_REMAIN
  if (v === undefined) return 3 // keep a few calls for foreground traffic
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 3
}

// Phase 8: breaker toggles (read by _breaker.ts internally); keeping helper exports for docs/tests
export function isBreakerEnabled(): boolean {
  const v = (process as any).env.BREAKER_ENABLED
  if (v === undefined) return true
  const s = String(v).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

// Feature flag: allow GNews /search fallback for PK "about" scope when top-headlines return nothing

// Feature flag: when upstream returns 429 and no stale cache exists,
// respond with 200 + empty items and a hint header instead of passing 429 through.
export function isPkSoft429Enabled(): boolean {
  const v = (process as any).env.PK_SOFT_429
  if (v === undefined) return false
  const s = String(v).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}
