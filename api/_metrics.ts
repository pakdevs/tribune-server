// Phase 7: Durable metrics accumulation (in-process). Rollup flush module will consume these.
// Storage-neutral counters + histograms for endpoint + upstream instrumentation.

// Latency bucket boundaries (ms)
const BOUNDS = [50, 100, 200, 400, 800, 1600, 3200]

export interface HistogramAcc {
  buckets: Record<string, number>
  sumMs: number
  count: number
}

function makeHist(): HistogramAcc {
  return {
    buckets: {
      '<50': 0,
      '<100': 0,
      '<200': 0,
      '<400': 0,
      '<800': 0,
      '<1600': 0,
      '<3200': 0,
      '>=3200': 0,
    },
    sumMs: 0,
    count: 0,
  }
}

interface HttpStatusCounters {
  '200': number
  '304': number
  '4xx': number
  '5xx': number
  '429': number
}

interface UpstreamCounters {
  ok: number
  error: number
  timeout: number
}

interface MetricsAccumulators {
  httpStatus: HttpStatusCounters
  httpLatency: HistogramAcc
  upstreamLatency: HistogramAcc
  upstream: UpstreamCounters
  etag304: number
  startedAt: number
}

const acc: MetricsAccumulators = {
  httpStatus: { '200': 0, '304': 0, '4xx': 0, '5xx': 0, '429': 0 },
  httpLatency: makeHist(),
  upstreamLatency: makeHist(),
  upstream: { ok: 0, error: 0, timeout: 0 },
  etag304: 0,
  startedAt: Date.now(),
}

function observe(hist: HistogramAcc, ms: number) {
  hist.sumMs += ms
  hist.count++
  if (ms < 50) hist.buckets['<50']++
  else if (ms < 100) hist.buckets['<100']++
  else if (ms < 200) hist.buckets['<200']++
  else if (ms < 400) hist.buckets['<400']++
  else if (ms < 800) hist.buckets['<800']++
  else if (ms < 1600) hist.buckets['<1600']++
  else if (ms < 3200) hist.buckets['<3200']++
  else hist.buckets['>=3200']++
}

export function recordHttp(status: number, latencyMs: number) {
  try {
    if (status === 200) acc.httpStatus['200']++
    else if (status === 304) {
      acc.httpStatus['304']++
      acc.etag304++
    } else if (status === 429) acc.httpStatus['429']++
    else if (status >= 500) acc.httpStatus['5xx']++
    else if (status >= 400) acc.httpStatus['4xx']++
    observe(acc.httpLatency, latencyMs)
  } catch {}
}

export function recordUpstream(result: 'ok' | 'error' | 'timeout', latencyMs: number) {
  try {
    acc.upstream[result]++
    observe(acc.upstreamLatency, latencyMs)
  } catch {}
}

export function snapshotAndReset() {
  const snap = JSON.parse(JSON.stringify(acc))
  // Reset (cheap) while preserving object identity
  acc.httpStatus['200'] = 0
  acc.httpStatus['304'] = 0
  acc.httpStatus['4xx'] = 0
  acc.httpStatus['5xx'] = 0
  acc.httpStatus['429'] = 0
  for (const k of Object.keys(acc.httpLatency.buckets)) acc.httpLatency.buckets[k] = 0
  acc.httpLatency.sumMs = 0
  acc.httpLatency.count = 0
  for (const k of Object.keys(acc.upstreamLatency.buckets)) acc.upstreamLatency.buckets[k] = 0
  acc.upstreamLatency.sumMs = 0
  acc.upstreamLatency.count = 0
  acc.upstream.ok = 0
  acc.upstream.error = 0
  acc.upstream.timeout = 0
  acc.etag304 = 0
  acc.startedAt = Date.now()
  return snap
}

export function metricsAccumulators() {
  return acc
}

// Percentile approximation (bucket midpoint heuristic)
export function histogramPercentiles(hist: HistogramAcc, percentiles: number[]) {
  const total = hist.count || 0
  if (!total) return Object.fromEntries(percentiles.map((p) => [p, 0]))
  const order = [
    ['<50', 25],
    ['<100', 75],
    ['<200', 150],
    ['<400', 300],
    ['<800', 600],
    ['<1600', 1200],
    ['<3200', 2400],
    ['>=3200', 4000], // arbitrary large midpoint
  ] as [string, number][]
  const targets = percentiles.map((p) => ({ p, pos: (p / 100) * total }))
  const result: Record<number, number> = {}
  let cumulative = 0
  for (const [bucket, mid] of order) {
    const c = (hist.buckets as any)[bucket] || 0
    if (!c) continue
    const prev = cumulative
    cumulative += c
    for (const t of targets) {
      if (!(t.p in result) && cumulative >= t.pos) {
        const within = c ? (t.pos - prev) / c : 0
        result[t.p] = mid // midpoint (ignore within fraction for now)
      }
    }
  }
  for (const t of targets) if (!(t.p in result)) result[t.p] = order[order.length - 1][1]
  return result
}
