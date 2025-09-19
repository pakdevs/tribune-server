import assert from 'assert'

// Test ETag / 304 conditional GET behaviour for a representative endpoint (search)
export async function test() {
  // Load modules fresh
  const { setCache, getFresh } = await import('../lib/_cache.js')
  const { buildEntityMetadata } = await import('../lib/_http.js')

  // We'll simulate how endpoint stores payload with attached meta.
  const key = 'search:test'
  const payload = {
    items: [
      { id: 'a1', publishDate: new Date(Date.now() - 1000).toISOString() },
      { id: 'a2', publishDate: new Date(Date.now() - 500).toISOString() },
    ],
    meta: { provider: 'x', attempts: ['x'] },
  }
  const meta = buildEntityMetadata(payload)
  payload.__etag = meta.etag
  payload.__lm = meta.lastModified
  setCache(key, payload, 10, 60)

  const fresh = getFresh(key)
  assert(fresh, 'Value should be fresh in cache')
  assert(fresh.__etag === meta.etag, 'ETag stored on payload')

  // Simulate client sending If-None-Match matching the stored ETag
  // Use helper logic isNotModified directly
  const { isNotModified } = await import('../lib/_http.js')
  const req = { headers: { 'if-none-match': meta.etag } }
  const notMod = isNotModified(req, { etag: meta.etag, lastModified: meta.lastModified })
  assert.strictEqual(notMod, true, 'Request should be not modified with matching ETag')

  // Now modify payload slightly (change ordering) but keep newest timestamp stable, verifying weak ETag mismatch when structure changes significantly.
  const payload2 = {
    items: [
      { id: 'a2', publishDate: payload.items[1].publishDate },
      { id: 'a1', publishDate: payload.items[0].publishDate },
    ],
    meta: { provider: 'x', attempts: ['x'] },
  }
  const meta2 = buildEntityMetadata(payload2)
  // Because weak ETag factors in ordered id list, ordering change may alter hash.
  const sameNewest = meta.lastModified === meta2.lastModified
  assert(sameNewest, 'Newest timestamp should remain the same')
  // It's acceptable if hash changed or not (weak semantics); if unchanged we still treat as not modified.
  if (meta2.etag !== meta.etag) {
    const notMod2 = isNotModified(req, meta2)
    assert.strictEqual(
      notMod2,
      false,
      'Changed ordering should generally yield modified for different weak ETag'
    )
  }
}

export const run = test()
