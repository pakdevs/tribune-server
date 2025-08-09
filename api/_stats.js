// Ephemeral in-memory provider usage statistics.
// Will reset on serverless cold start. Suitable only for short-term debugging.

const stats = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  providers: {}, // provider -> counters
}

function ensure(name) {
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

export function recordSuccess(name, articles) {
  const p = ensure(name)
  p.success++
  p.articles += Number(articles || 0)
  p.lastSuccess = new Date().toISOString()
  stats.totalRequests++
}

export function recordEmpty(name) {
  const p = ensure(name)
  p.empty++
  stats.totalRequests++
}

export function recordError(name, _message) {
  const p = ensure(name)
  p.error++
  p.lastError = new Date().toISOString()
  stats.totalRequests++
}

export function getStats() {
  return {
    ...stats,
    providers: { ...stats.providers },
  }
}
