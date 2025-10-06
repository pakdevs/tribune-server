import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveRegionFeed,
  buildProviderOptionsFromRegion,
  REGION_CONFIGS,
} from '../lib/regions.ts'
import { buildPakistanOrQuery } from '../lib/pkTerms.ts'

test('resolveRegionFeed returns Pakistan top config by default', () => {
  const resolved = resolveRegionFeed('pakistan')
  assert.equal(resolved.region.key, 'pakistan')
  assert.equal(resolved.feedKey, 'top')
  assert.equal(resolved.intent, 'top')
  assert.ok(Array.isArray(resolved.feed.locationUris), 'should include location uris array')
  assert.deepEqual(resolved.feed.locationUris, ['http://en.wikipedia.org/wiki/Pakistan'])
})

test('resolveRegionFeed selects business feed with search intent', () => {
  const resolved = resolveRegionFeed('pakistan', { feed: 'business' })
  assert.equal(resolved.feedKey, 'business')
  assert.equal(resolved.intent, 'search')
  assert.deepEqual(resolved.feed.conceptUris, REGION_CONFIGS.pakistan.business?.conceptUris)
})

test('resolveRegionFeed selects local feed and exposes metadata', () => {
  const resolved = resolveRegionFeed('pakistan', { local: 'karachi' })
  assert.equal(resolved.feedKey, 'local:karachi')
  assert.equal(resolved.local?.key, 'karachi')
  assert.equal(resolved.intent, 'search')
  assert.equal(resolved.feed.keywords, 'karachi')
})

test('buildProviderOptionsFromRegion respects defaults and overrides', () => {
  const resolved = resolveRegionFeed('pakistan')
  const opts = buildProviderOptionsFromRegion(resolved, { page: 2, pageSize: 15 })
  assert.equal(opts.page, 2)
  assert.equal(opts.pageSize, 15)
  assert.equal(opts.country, 'pk')
  assert.equal(opts.language, 'eng')
  assert.equal(opts.q, buildPakistanOrQuery(16))
})

test('buildProviderOptionsFromRegion merges overrides without clobbering config arrays', () => {
  const resolved = resolveRegionFeed('pakistan', { feed: 'business' })
  const opts = buildProviderOptionsFromRegion(resolved, {
    page: 1,
    pageSize: 20,
    q: 'energy transition',
    domains: ['example.com'],
    sources: ['sample-source'],
  })
  assert.equal(opts.q, 'energy transition')
  assert.deepEqual(opts.conceptUris, REGION_CONFIGS.pakistan.business?.conceptUris)
  assert.deepEqual(opts.domains, ['example.com'])
  assert.deepEqual(opts.sources, ['sample-source'])
})

test('buildProviderOptionsFromRegion throws for unknown local', () => {
  assert.throws(() => resolveRegionFeed('pakistan', { local: 'unknown-city' }))
})
