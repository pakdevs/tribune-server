import assert from 'node:assert/strict'
import test from 'node:test'
import { normalize } from '../api/_normalize.ts'

test('isFromPK true for .pk domain', () => {
  const b = normalize({ title: 'x', url: 'https://tribune.com.pk/news' })
  assert.equal(b?.isFromPK, true)
})

test('isAboutPK true when title mentions Pakistan', () => {
  const b = normalize({ title: 'Pakistan wins series', url: 'https://y.com' })
  assert.equal(!!b?.isAboutPK, true)
})
