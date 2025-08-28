import assert from 'node:assert/strict'
import test from 'node:test'
import { normalize } from '../api/_normalize.ts'

const sample = {
  title: 'Hello',
  description: 'World',
  url: 'https://example.com/a',
  source: { name: 'example.com' },
  publishedAt: '2025-01-01T00:00:00Z',
}

test('normalize produces required fields', () => {
  const n = normalize(sample)
  assert.ok(n)
  assert.equal(n.title, 'Hello')
  assert.equal(n.summary, 'World')
  assert.equal(n.link, 'https://example.com/a')
  assert.equal(n.sourceName.toLowerCase(), 'example.com')
  assert.equal(n.displaySourceName, 'Example')
})
