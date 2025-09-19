import assert from 'assert'

export async function test() {
  process.env.ETAG_MODE = 'weak'
  process.env.ETAG_SORT = '1'
  const { buildEntityMetadata } = await import('../lib/_http.js')
  const baseItems = [
    { id: 'a', publishDate: '2025-09-16T10:00:00Z', title: 'First' },
    { id: 'b', publishDate: '2025-09-16T09:00:00Z', title: 'Second' },
    { id: 'c', publishDate: '2025-09-15T23:00:00Z', title: 'Third' },
  ]
  const meta1 = buildEntityMetadata({ items: baseItems })
  const meta2 = buildEntityMetadata({ items: baseItems.slice().reverse() })
  assert.strictEqual(meta1.etag, meta2.etag, 'Weak sorted ETag should be invariant to ordering')
}

export const run = test()
