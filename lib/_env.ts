// Load environment variables for local development. In production (Vercel),
// env vars are provided by the platform and this import is a no-op.
import 'dotenv/config'

// Webz.io API key (set WEBZ_API in Vercel env)
export function getWebzApiKey(): string | undefined {
  const key = (process as any).env.WEBZ_API
  return key ? String(key) : undefined
}

// GNews API key (set GNEWS_API in Vercel env)
export function getGnewsApiKey(): string | undefined {
  const key = (process as any).env.GNEWS_API
  return key ? String(key) : undefined
}

// Whether to use Webz News API Lite (free tier). Defaults to true if unset.
export function getWebzUseLite(): boolean {
  const v = (process as any).env.WEBZ_USE_LITE
  if (v === undefined) return true
  const s = String(v).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

// Daily request budget for Webz to preserve the 1000/month quota.
// Example: WEBZ_DAILY_LIMIT=25 (roughly ~750/month)
export function getWebzDailyLimit(): number {
  const v = (process as any).env.WEBZ_DAILY_LIMIT
  if (v === undefined) return 30 // conservative default
  const n = Number(v)
  return Number.isFinite(n) ? n : 30
}

// Logical cost per Webz call (Lite). Default 1. Can be tuned if we count next-page fetches as extra.
export function getWebzCallCost(): number {
  const v = (process as any).env.WEBZ_CALL_COST
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

// Feature flag: allow GNews /search fallback for PK "about" scope when Webz returns nothing
export function isPkAboutGnewsSearchFallbackEnabled(): boolean {
  const v = (process as any).env.PK_ABOUT_GNEWS_SEARCH_FALLBACK
  if (v === undefined) return false
  const s = String(v).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}
