import assert from 'node:assert/strict'
import test from 'node:test'
import { tryProvidersSequential } from '../api/_providers.ts'

// This test checks that when domains/sources filters are present,
// the provider ordering prefers Webz and the query includes site: and site_type:news.

test('prefers Webz for source/domain filtering and builds proper query', async () => {
  const providers = [
    { type: 'newsdata', key: 'pub_dummy' },
    { type: 'webz', key: 'token_dummy' },
  ]

  const opts = {
    page: 1,
    pageSize: 5,
    country: 'pk',
    domains: ['dawn.com'],
    sources: [],
    q: 'politics',
  }

  const fetcher = async (url, headers) => {
    if (url.includes('api.webz.io')) {
      return {
        posts: [
          {
            title: 'Sample',
            url: 'https://www.dawn.com/news/sample',
            site: 'dawn.com',
            main_image: '',
          },
        ],
      }
    }
    if (url.includes('newsdata.io')) {
      return { status: 'success', results: [] }
    }
    return { results: [] }
  }

  const res = await tryProvidersSequential(providers, 'top', opts, fetcher)
  assert.equal(res.provider, 'webz', 'should select webz as provider')
  assert.equal(res.attempts[0], 'webz', 'webz should be attempted first with domain filter')
  assert.ok(
    decodeURIComponent(res.url).includes('site:dawn.com'),
    'query should include site:dawn.com'
  )
  assert.ok(
    decodeURIComponent(res.url).includes('site_type:news'),
    'query should include site_type:news by default'
  )
  assert.ok(Array.isArray(res.items) && res.items.length === 1, 'should return mocked post')
})
