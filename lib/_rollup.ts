import { snapshotAndReset, histogramPercentiles, HistogramAcc } from './_metrics.js'

type RollupDoc = {
  hour: string
  startedAt: number
  updatedAt: number
  httpStatus: Record<string, number>
  httpLatency: HistogramAcc
  upstreamLatency: HistogramAcc
  upstream: Record<string, number>
  etag304: number
}

const HOUR_MS = 3600_000

function formatHour(ts: number) {
  const d = new Date(ts)
  const YYYY = d.getUTCFullYear()
  const MM = String(d.getUTCMonth() + 1).padStart(2, '0')
  const DD = String(d.getUTCDate()).padStart(2, '0')
  const HH = String(d.getUTCHours()).padStart(2, '0')
  return `${YYYY}${MM}${DD}${HH}`
}

// In-memory fallback store (used if no KV)
;(globalThis as any).__metricsRollups =
  (globalThis as any).__metricsRollups || new Map<string, RollupDoc>()
const memRollups: Map<string, RollupDoc> = (globalThis as any).__metricsRollups

async function getKV() {
  try {
    const mod: any = await import('@vercel/kv').catch(() => null)
    return mod?.kv || null
  } catch {
    return null
  }
}

function mergeHistogram(into: HistogramAcc, add: HistogramAcc) {
  into.sumMs += add.sumMs
  into.count += add.count
  for (const k of Object.keys(into.buckets)) {
    ;(into.buckets as any)[k] += (add.buckets as any)[k] || 0
  }
}

function newEmptyDoc(hour: string): RollupDoc {
  const emptyHist = () => ({
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
  })
  return {
    hour,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    httpStatus: { '200': 0, '304': 0, '4xx': 0, '5xx': 0, '429': 0 },
    httpLatency: emptyHist(),
    upstreamLatency: emptyHist(),
    upstream: { ok: 0, error: 0, timeout: 0 },
    etag304: 0,
  }
}

async function loadRollup(hour: string): Promise<RollupDoc> {
  const kv = await getKV()
  if (kv) {
    const key = `metrics:rollup:${hour}`
    const existing = (await kv.get(key)) as RollupDoc | null
    if (existing) return existing
  }
  if (memRollups.has(hour)) return memRollups.get(hour) as RollupDoc
  const doc = newEmptyDoc(hour)
  memRollups.set(hour, doc)
  return doc
}

async function saveRollup(doc: RollupDoc) {
  const kv = await getKV()
  if (kv) {
    const key = `metrics:rollup:${doc.hour}`
    await kv.set(key, doc, { ex: retentionHours() * 3600 }) // TTL aligns with retention
  }
  memRollups.set(doc.hour, doc)
}

function retentionHours() {
  const v = Number(process.env.ROLLUP_RETENTION_HOURS || '72')
  return v > 0 ? v : 72
}

function flushIntervalMs() {
  const v = Number(process.env.ROLLUP_FLUSH_INTERVAL_MS || '300000')
  return v > 10_000 ? v : 300_000
}

export async function flushMetricsNow() {
  const snap = snapshotAndReset()
  const hour = formatHour(Date.now())
  const doc = await loadRollup(hour)
  // Merge counters
  for (const k of Object.keys(doc.httpStatus)) {
    doc.httpStatus[k] += snap.httpStatus[k] || 0
  }
  for (const k of Object.keys(doc.upstream)) {
    doc.upstream[k] += snap.upstream[k] || 0
  }
  doc.etag304 += snap.etag304 || 0
  mergeHistogram(doc.httpLatency, snap.httpLatency)
  mergeHistogram(doc.upstreamLatency, snap.upstreamLatency)
  doc.updatedAt = Date.now()
  await saveRollup(doc)
  return { hour, merged: true }
}

function retentionPurge() {
  const maxAge = retentionHours() * HOUR_MS
  const now = Date.now()
  for (const [hour, doc] of memRollups.entries()) {
    // Derive time: parse hour back to Date
    const ts = Date.UTC(
      Number(hour.slice(0, 4)),
      Number(hour.slice(4, 6)) - 1,
      Number(hour.slice(6, 8)),
      Number(hour.slice(8, 10))
    )
    if (now - ts > maxAge) memRollups.delete(hour)
  }
}

let started = false
export function ensureRollupLoop() {
  if (started) return
  started = true
  const enable = String(process.env.ROLLUP_ENABLE || '1') === '1'
  if (!enable) return
  const run = async () => {
    try {
      await flushMetricsNow()
      retentionPurge()
    } catch {}
    const h: any = setTimeout(run, flushIntervalMs())
    if (typeof h?.unref === 'function') h.unref()
  }
  const h: any = setTimeout(run, flushIntervalMs())
  if (typeof h?.unref === 'function') h.unref()
}

// Helper for querying last N hours (in-memory + KV best-effort)
export async function getRollups(hours: number) {
  const now = Date.now()
  const list: RollupDoc[] = []
  for (let i = 0; i < hours; i++) {
    const ts = now - i * HOUR_MS
    const hour = formatHour(ts)
    const doc = await loadRollup(hour)
    list.push(doc)
  }
  return list
}

// Aggregate rollups into summary with optional percentiles
export function summarizeRollups(docs: RollupDoc[]) {
  const summary = newEmptyDoc('aggregate')
  summary.startedAt = Math.min(...docs.map((d) => d.startedAt))
  summary.updatedAt = Math.max(...docs.map((d) => d.updatedAt))
  for (const d of docs) {
    for (const k of Object.keys(summary.httpStatus)) summary.httpStatus[k] += d.httpStatus[k] || 0
    for (const k of Object.keys(summary.upstream)) summary.upstream[k] += d.upstream[k] || 0
    summary.etag304 += d.etag304 || 0
    mergeHistogram(summary.httpLatency, d.httpLatency)
    mergeHistogram(summary.upstreamLatency, d.upstreamLatency)
  }
  const pctHttp = histogramPercentiles(summary.httpLatency, [50, 90, 95, 99])
  const pctUp = histogramPercentiles(summary.upstreamLatency, [50, 90, 95, 99])
  return { summary, percentiles: { http: pctHttp, upstream: pctUp } }
}

// Test-only exports
export function __test_only_injectHour(hour, docPartial) {
  if (process.env.NODE_ENV !== 'test') return
  const base = {
    hour,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    httpStatus: { '200': 0, '304': 0, '4xx': 0, '5xx': 0, '429': 0 },
    httpLatency: {
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
    },
    upstreamLatency: {
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
    },
    upstream: { ok: 0, error: 0, timeout: 0 },
    etag304: 0,
  }
  const merged = Object.assign(base, docPartial || {})
  ;(globalThis as any).__metricsRollups.set(hour, merged)
}

export function __test_only_forceRetentionPurge() {
  if (process.env.NODE_ENV !== 'test') return
  // invoke internal purge through a public path
  const maxAge = Number(process.env.ROLLUP_RETENTION_HOURS || '72') * 3600_000
  const now = Date.now()
  for (const [hour] of (globalThis as any).__metricsRollups.entries()) {
    const ts = Date.UTC(
      Number(hour.slice(0, 4)),
      Number(hour.slice(4, 6)) - 1,
      Number(hour.slice(6, 8)),
      Number(hour.slice(8, 10))
    )
    if (now - ts > maxAge) (globalThis as any).__metricsRollups.delete(hour)
  }
}

// Auto start loop when imported (safe & idempotent)
ensureRollupLoop()
