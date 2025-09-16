import assert from 'node:assert'
import { canonicalizeParams, buildCacheKey, shortHashKey } from '../api/_key.js'

// Basic invariants
const a = { q: 'Hello World', country: 'US', page: 1, domains: ['Bbc.com', 'cnn.com', 'Cnn.com'] }
const b = { page: 1, country: 'us', q: '  hello world  ', domains: ['cnn.com', 'bbc.com'] }

const ca = canonicalizeParams(a)
const cb = canonicalizeParams(b)

assert.deepEqual(ca, cb, 'Canonicalization must normalize case, trim, sort arrays, de-dupe')

const ka = buildCacheKey('search', a)
const kb = buildCacheKey('search', b)
assert.equal(ka, kb, 'Cache keys should match for semantically equivalent inputs')

// Ensure version prefix present
assert.ok(ka.startsWith('v1|search|'), 'Key must start with version and prefix')

// Short hash should be deterministic
assert.equal(shortHashKey(ka), shortHashKey(kb), 'Short hash must be stable for same key')

// Distinct difference leads to different key
const kc = buildCacheKey('search', { ...b, page: 2 })
assert.notEqual(kb, kc, 'Different page should produce different key')

console.log('cache.key.test.mjs passed')
