import assert from 'assert'

export async function test() {
  const { buildEntityMetadata } = await import('../lib/_http.js')
  // Initial payload
  const baseTs = Date.now() - 5000
  const p1 = {
    items: [
      { id: 'x1', title: 'Hello World', publishDate: new Date(baseTs).toISOString() },
      { id: 'x2', title: 'Good Morning', publishDate: new Date(baseTs + 1000).toISOString() },
    ],
  }
  const m1 = buildEntityMetadata(p1)
  // Modified payload: newest publishDate shifts forward
  const p2 = {
    items: [
      { id: 'x1', title: 'Hello World', publishDate: new Date(baseTs).toISOString() },
      { id: 'x2', title: 'Good Morning', publishDate: new Date(baseTs + 3000).toISOString() },
    ],
  }
  const m2 = buildEntityMetadata(p2)
  assert.notStrictEqual(
    m1.lastModified,
    m2.lastModified,
    'Last-Modified should change with newer publishDate'
  )
  // Simulate client with old ETag / LM; should not be considered not-modified for new meta
  const { isNotModified } = await import('../lib/_http.js')
  const req = { headers: { 'if-none-match': m1.etag, 'if-modified-since': m1.lastModified } }
  const result = isNotModified(req, m2)
  assert.strictEqual(result, false, 'Should NOT return 304 when publishDate advanced')
}

export const run = test()
