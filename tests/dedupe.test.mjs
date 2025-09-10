import test from 'node:test'
import assert from 'node:assert/strict'
import { titleSimilarity, dedupeByTitle } from '../api/_dedupe.ts'

test('titleSimilarity catches close variants', () => {
  const a = 'Pakistan wins the T20 series against India'
  const b = 'T20 series: Pakistan wins against India'
  const s = titleSimilarity(a, b)
  assert.ok(s >= 0.6, `similarity too low: ${s}`)
})

test('dedupeByTitle removes near-duplicates', () => {
  const items = [
    { id: '1', title: 'Pakistan wins the T20 series against India' },
    { id: '2', title: 'T20 series: Pakistan wins against India' },
    { id: '3', title: 'Karachi weather update: rain expected' },
  ]
  const out = dedupeByTitle(items, 0.6)
  assert.equal(out.length, 2)
})
