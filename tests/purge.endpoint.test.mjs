import assert from 'assert'

export async function test() {
  // Simulate calling purge handler directly (no HTTP server launch needed)
  const { setCache } = await import('../lib/_cache.js')
  const purgeMod = await import('../api/purge.ts')
  // Insert entry
  setCache('purge:test:key', { ok: true }, 30, 30)
  // Unauthorized
  let resBody = ''
  const res1 = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    end(b) {
      resBody = b || ''
    },
  }
  await purgeMod.default({ method: 'GET', headers: {}, query: { key: 'purge:test:key' } }, res1)
  assert(res1.statusCode === 401, 'Should require token')
  // Authorized purge
  process.env.ADMIN_PURGE_TOKEN = 'TEST'
  let resBody2 = ''
  const res2 = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    end(b) {
      resBody2 = b || ''
    },
  }
  await purgeMod.default(
    { method: 'GET', headers: { 'x-admin-token': 'TEST' }, query: { key: 'purge:test:key' } },
    res2
  )
  assert(res2.statusCode === 200, 'Purge should succeed')
  assert(/"purged":1/.test(resBody2), 'Response should indicate 1 purged')
}

export const run = test()
