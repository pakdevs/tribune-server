import assert from 'assert'

export async function test() {
  // Simulate trending topics payload (topics stored under items for metadata builder compatibility)
  const { buildEntityMetadata } = await import('../lib/_http.js')
  process.env.ETAG_MODE = 'strong'
  const items = [
    { id: 'economy', publishDate: '2025-09-16T08:00:00Z', title: 'Economy Growth' },
    { id: 'sports', publishDate: '2025-09-16T07:00:00Z', title: 'Sports Win' },
  ]
  const meta1 = buildEntityMetadata({ items })
  // Modify a title -> should change strong ETag
  const items2 = [
    { id: 'economy', publishDate: '2025-09-16T08:00:00Z', title: 'Economy Growth Revised' },
    { id: 'sports', publishDate: '2025-09-16T07:00:00Z', title: 'Sports Win' },
  ]
  const meta2 = buildEntityMetadata({ items: items2 })
  assert.notStrictEqual(meta1.etag, meta2.etag, 'Strong ETag should change when a title changes')
}

export const run = test()
