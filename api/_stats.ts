import { cacheStats } from './_cache.js'

type ProviderStats = {
  success: number
  empty: number
  error: number
  articles: number
  lastSuccess: string | null
  lastError: string | null
}

const stats: {
  startedAt: string
  totalRequests: number
  providers: Record<string, ProviderStats>
} = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  providers: {},
}

function ensure(name: string): ProviderStats {
  if (!stats.providers[name]) {
    stats.providers[name] = {
      success: 0,
      empty: 0,
      error: 0,
      articles: 0,
      lastSuccess: null,
      lastError: null,
    }
  }
  return stats.providers[name]
}

export function recordSuccess(name: string, articles?: number) {
  const p = ensure(name)
  p.success++
  p.articles += Number(articles || 0)
  p.lastSuccess = new Date().toISOString()
  stats.totalRequests++
}

export function recordEmpty(name: string) {
  const p = ensure(name)
  p.empty++
  stats.totalRequests++
}

export function recordError(name: string, _message?: string) {
  const p = ensure(name)
  p.error++
  p.lastError = new Date().toISOString()
  stats.totalRequests++
}

export function getStats() {
  let cache: any = null
  try {
    cache = cacheStats()
  } catch {}
  return { ...stats, providers: { ...stats.providers }, cache }
}
