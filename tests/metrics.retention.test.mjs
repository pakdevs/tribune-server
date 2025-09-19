import assert from 'assert'
import {
  __test_only_injectHour,
  __test_only_forceRetentionPurge,
  getRollups,
} from '../lib/_rollup.js'

export async function test_retention_purge() {
  process.env.ROLLUP_RETENTION_HOURS = '1' // 1 hour retention
  const now = Date.now()
  const hour = (ts) => {
    const d = new Date(ts)
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
      d.getUTCDate()
    ).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}`
  }
  const currentHour = hour(now)
  const oldHour = hour(now - 3 * 3600_000)
  __test_only_injectHour(currentHour, {
    httpStatus: { 200: 5, 304: 0, '4xx': 0, '5xx': 0, 429: 0 },
  })
  __test_only_injectHour(oldHour, { httpStatus: { 200: 9, 304: 0, '4xx': 0, '5xx': 0, 429: 0 } })
  __test_only_forceRetentionPurge()
  const docs = await getRollups(4)
  // Ensure old hour not present with its data (it may be re-created empty on access, so we check absence of the injected count)
  const foundOld = docs.find((d) => d.hour === oldHour)
  if (foundOld) {
    assert.notStrictEqual(foundOld.httpStatus['200'], 9, 'old hour data should be purged')
  }
  const foundCurrent = docs.find((d) => d.hour === currentHour)
  assert.ok(foundCurrent, 'current hour exists')
  assert.strictEqual(foundCurrent.httpStatus['200'], 5, 'current hour retained')
}

export const tests = { test_retention_purge }
