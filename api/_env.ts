// Load environment variables for local development. In production (Vercel),
// env vars are provided by the platform and this import is a no-op.
import 'dotenv/config'

// NewsAPI.ai API key (set NEWSAPI_AI in Vercel env). Falls back to legacy GNEWS_API for compatibility.
export function getNewsApiAiKey(): string | undefined {
  const key = (process as any).env.NEWSAPI_AI || (process as any).env.GNEWS_API
  return key ? String(key) : undefined
}

// Daily request budget for NewsAPI.ai to preserve quota/costs
export function getNewsApiAiDailyLimit(): number {
  const raw = (process as any).env.NEWSAPI_AI_DAILY_LIMIT ?? (process as any).env.GNEWS_DAILY_LIMIT
  if (raw === undefined) return 500
  const n = Number(raw)
  return Number.isFinite(n) ? n : 500
}

// Logical cost per NewsAPI.ai call
export function getNewsApiAiCallCost(): number {
  const raw = (process as any).env.NEWSAPI_AI_CALL_COST ?? (process as any).env.GNEWS_CALL_COST
  if (raw === undefined) return 1
  const n = Number(raw)
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
