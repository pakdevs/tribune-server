import assert from 'assert'
import { __test_only_injectHour, summarizeRollups } from '../lib/_rollup.js'
import { evaluateSLOs } from '../lib/_slo.js'

// We simulate two hours of data with high 5xx + high upstream error to trigger alerts.
export async function test_slo_alerts() {
  process.env.SLO_ENABLE = '0' // disable loop during test
  process.env.SLO_HTTP_5XX_BUDGET = '0.05'
  process.env.SLO_HTTP_P95_MS = '500'
  process.env.SLO_UPSTREAM_ERROR_BUDGET = '0.10'
  process.env.SLO_EVAL_HOURS = '2'

  const now = Date.now()
  const hourKey = (ts) => {
    const d = new Date(ts)
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
      d.getUTCDate()
    ).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}`
  }
  const h1 = hourKey(now)
  const h0 = hourKey(now - 3600_000)

  __test_only_injectHour(h0, {
    httpStatus: { 200: 50, 304: 0, '4xx': 0, '5xx': 10, 429: 0 },
    httpLatency: {
      buckets: {
        '<50': 0,
        '<100': 0,
        '<200': 0,
        '<400': 0,
        '<800': 60,
        '<1600': 0,
        '<3200': 0,
        '>=3200': 0,
      },
      sumMs: 60 * 700,
      count: 60,
    },
    upstream: { ok: 80, error: 15, timeout: 5 },
    upstreamLatency: {
      buckets: {
        '<50': 0,
        '<100': 0,
        '<200': 0,
        '<400': 0,
        '<800': 100,
        '<1600': 0,
        '<3200': 0,
        '>=3200': 0,
      },
      sumMs: 100 * 600,
      count: 100,
    },
    etag304: 0,
  })
  __test_only_injectHour(h1, {
    httpStatus: { 200: 40, 304: 0, '4xx': 0, '5xx': 12, 429: 0 },
    httpLatency: {
      buckets: {
        '<50': 0,
        '<100': 0,
        '<200': 0,
        '<400': 0,
        '<800': 52,
        '<1600': 0,
        '<3200': 0,
        '>=3200': 0,
      },
      sumMs: 52 * 650,
      count: 52,
    },
    upstream: { ok: 60, error: 20, timeout: 10 },
    upstreamLatency: {
      buckets: {
        '<50': 0,
        '<100': 0,
        '<200': 0,
        '<400': 0,
        '<800': 90,
        '<1600': 0,
        '<3200': 0,
        '>=3200': 0,
      },
      sumMs: 90 * 620,
      count: 90,
    },
    etag304: 0,
  })

  const res = await evaluateSLOs()
  assert.ok(res.alerts.length >= 2, 'Expect multiple SLO alerts (5xx + upstream + latency)')
  const types = res.alerts.map((a) => a.type)
  assert.ok(types.includes('http-5xx'), 'contains 5xx alert')
  assert.ok(types.includes('upstream-error'), 'contains upstream error alert')
  assert.ok(types.includes('http-latency-p95'), 'contains latency p95 alert')
}

export const tests = { test_slo_alerts }
