import assert from 'assert'
import { summarizeRollups, __test_only_injectHour } from '../api/_rollup.js'

function makeHist(counts) {
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
      ...counts,
    },
    sumMs: 0,
    count: Object.values(counts).reduce((a, b) => a + b, 0),
  }
}

export async function test_percentile_ordering() {
  const hour = '2999123123' // far future synthetic hour key
  __test_only_injectHour(hour, {
    httpLatency: makeHist({ '<50': 10, '<100': 5, '<200': 5, '<400': 2, '<800': 1 }),
    upstreamLatency: makeHist({ '<50': 2, '<100': 8, '<200': 10, '<400': 3, '>=3200': 1 }),
  })
  const { summary, percentiles } = summarizeRollups([globalThis.__metricsRollups.get(hour)])
  const p = percentiles.http
  assert.ok(p[50] <= p[90] && p[90] <= p[95] && p[95] <= p[99], 'http percentile monotonic')
  const up = percentiles.upstream
  assert.ok(
    up[50] <= up[90] && up[90] <= up[95] && up[95] <= up[99],
    'upstream percentile monotonic'
  )
  assert.ok(summary.httpLatency.count > 0, 'histogram counted')
}

export const tests = { test_percentile_ordering }
