// Load environment variables for local development. In production (Vercel),
// env vars are provided by the platform and this import is a no-op.
import 'dotenv/config'

// Primary provider key for NewsData.io
export function getNewsDataApiKey(): string | undefined {
  if ((process as any).env.NEWSDATA_API) return (process as any).env.NEWSDATA_API
  // Legacy fallbacks (none for NewsData.io); return undefined if missing
  return undefined
}

// Webz.io API key (set WEBZ_API in Vercel env)
export function getWebzApiKey(): string | undefined {
  const key = (process as any).env.WEBZ_API
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
