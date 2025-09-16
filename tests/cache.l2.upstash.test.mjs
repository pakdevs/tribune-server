import assert from 'assert'

/**
 * Upstash provider test (mocked fetch):
 * - Ensures key prefix + TTL multiplier applied
 * - Verifies JSON round-trip using REST shape { result }
 */
export async function test() {
  process.env.ENABLE_L2_CACHE = '1'
  process.env.CACHE_KEY_PREFIX = 'trib:v1:'
  process.env.L2_TTL_MULT = '3'
  process.env.UPSTASH_REDIS_REST_URL = 'https://mock-upstash-url' // placeholder (not actually called)
  process.env.UPSTASH_REDIS_REST_TOKEN = 'TEST_TOKEN'

  // Capture fetch calls
  const calls = []
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts })
    if (url.includes('/get/')) {
      // Simulate miss first then hit
      if (!calls.some((c) => c.url.includes('__written'))) {
        return { ok: true, json: async () => ({ result: null }) }
      }
      return { ok: true, json: async () => ({ result: JSON.stringify({ value: 123 }) }) }
    }
    if (url.includes('/set/')) {
      return { ok: true, json: async () => ({ result: 'OK', __written: true }) }
    }
    return { ok: false, json: async () => ({}) }
  }

  const { l2Set, l2Get } = await import('../api/_l2.js')
  await l2Set('foo', { value: 123 }, 10) // effective TTL should be 30 via multiplier 3
  const v = await l2Get('foo')
  assert(v && v.value === 123, 'should retrieve mocked value')
  // Assertions on calls
  const setCall = calls.find((c) => c.url.includes('/set/'))
  assert(setCall, 'set call occurred')
  assert(/EX=30/.test(setCall.url), 'TTL multiplier applied (10 * 3) => 30')
  assert(setCall.url.includes('/set/trib%3Av1%3Afoo/'), 'prefixed & encoded key present in set URL')
}

export const run = test()
