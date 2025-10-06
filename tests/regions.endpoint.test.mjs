import assert from 'node:assert/strict'
import test from 'node:test'

import handler from '../api/regions.ts'

function createResponseRecorder() {
  const recorder = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[key] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
    end(payload) {
      this.body = payload
      return this
    },
  }
  return recorder
}

test('GET /api/regions returns region list', async () => {
  const res = createResponseRecorder()
  await handler({ method: 'GET', query: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.ok(res.headers['Cache-Control'], 'should set cache headers')
  assert.ok(res.headers['X-Regions-Count'], 'should set region count header')
  const payload = res.body
  assert.ok(Array.isArray(payload?.regions), 'response should include regions array')
  const pakistan = payload.regions.find((r) => r.key === 'pakistan')
  assert.ok(pakistan, 'should include pakistan region')
  assert.ok(
    Array.isArray(pakistan.feeds) && pakistan.feeds.length >= 1,
    'pakistan should expose feeds'
  )
  const topFeed = pakistan.feeds.find((f) => f.key === 'top')
  assert.equal(topFeed.intent, 'top')
})

test('GET /api/regions?region=pakistan returns single region', async () => {
  const res = createResponseRecorder()
  await handler({ method: 'GET', query: { region: 'pakistan' } }, res)
  assert.equal(res.statusCode, 200)
  const payload = res.body
  assert.equal(payload.regions.length, 1)
  assert.equal(payload.regions[0].key, 'pakistan')
})

test('GET /api/regions?region=unknown returns 404', async () => {
  const res = createResponseRecorder()
  await handler({ method: 'GET', query: { region: 'unknown' } }, res)
  assert.equal(res.statusCode, 404)
})

test('POST /api/regions returns 405', async () => {
  const res = createResponseRecorder()
  await handler({ method: 'POST', query: {} }, res)
  assert.equal(res.statusCode, 405)
  assert.equal(res.headers['Allow'], 'GET, OPTIONS')
})
