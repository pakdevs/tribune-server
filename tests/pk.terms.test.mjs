import assert from 'node:assert/strict'
import test from 'node:test'
import { PK_TERMS, buildPakistanOrQuery } from '../lib/pkTerms.ts'

// Ensure multi-word phrases are quoted and joined with OR
test('buildPakistanOrQuery basic formatting', () => {
  const q = buildPakistanOrQuery(25)
  // Expect parentheses and OR separators
  assert.match(q, /^\(.* OR .*\)$/)
  // Multi-word phrase should be quoted
  assert.ok(q.includes('"pak rupee"') || q.includes('"state bank"') || q.includes('"imran khan"'))
})

// Guard should not exceed encoded length budget
test('buildPakistanOrQuery length guard', () => {
  // Temporarily stuff many artificial long terms to force trimming
  const originalLength = PK_TERMS.length
  for (let i = 0; i < 200; i++) PK_TERMS.push('verylongmadeupterm' + i)
  buildPakistanOrQuery.clearMemo()
  const q = buildPakistanOrQuery(400, 1200) // force smaller limit for test speed
  const encLen = encodeURIComponent(q).length
  assert.ok(encLen <= 1200, 'encoded length should be <= 1200')
  // Ensure we still have at least 2 terms OR single term if extreme trim
  const core = q.replace(/^\(|\)$/g, '')
  const parts = core.split(' OR ')
  assert.ok(parts.length >= 1)
  // Clean up (trim back to original)
  PK_TERMS.length = originalLength
  buildPakistanOrQuery.clearMemo()
})

// Memoization hit path
test('buildPakistanOrQuery memoization stable', () => {
  buildPakistanOrQuery.clearMemo()
  const a = buildPakistanOrQuery(12)
  const b = buildPakistanOrQuery(12)
  assert.equal(a, b)
})
