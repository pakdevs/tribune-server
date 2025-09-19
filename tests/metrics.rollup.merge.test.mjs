import assert from 'assert'

// Import the modules under test
import { recordHttp, recordUpstream, snapshotAndReset } from '../lib/_metrics.js'
import { flushMetricsNow, getRollups, summarizeRollups } from '../lib/_rollup.js'

// We rely on flushMetricsNow performing a snapshotAndReset internally.
// This test simulates multiple observations in one hour and checks aggregation.

export async function test_rollup_merge() {
  // Simulate 10 HTTP successes, 2 5xx, 1 429, and upstream timings
  for (let i = 0; i < 10; i++) recordHttp(200, 42)
  for (let i = 0; i < 2; i++) recordHttp(500, 150)
  recordHttp(429, 60)
  for (let i = 0; i < 5; i++) recordUpstream('ok', 80)
  for (let i = 0; i < 3; i++) recordUpstream('error', 120)
  recordUpstream('timeout', 900)

  await flushMetricsNow()

  // Add a second batch
  for (let i = 0; i < 4; i++) recordHttp(200, 30)
  recordHttp(304, 20)
  recordUpstream('ok', 70)
  await flushMetricsNow()

  const docs = await getRollups(1)
  assert.strictEqual(docs.length, 1, 'expected single hour doc')
  const d = docs[0]
  assert.strictEqual(d.httpStatus['200'], 14, 'merged 200 count')
  assert.strictEqual(d.httpStatus['5xx'], 2, 'merged 5xx count')
  assert.strictEqual(d.httpStatus['429'], 1, 'merged 429 count')
  assert.strictEqual(d.httpStatus['304'], 1, 'merged 304 count')
  assert.strictEqual(d.upstream.ok, 6, 'merged upstream ok')
  assert.strictEqual(d.upstream.error, 3, 'merged upstream error')
  assert.strictEqual(d.upstream.timeout, 1, 'merged upstream timeout')
  assert.ok(d.httpLatency.count >= 17, 'latency samples accounted')
  const { percentiles } = summarizeRollups(docs)
  assert.ok(percentiles.http[95] >= percentiles.http[50], 'p95 >= p50')
}

export const tests = { test_rollup_merge }
