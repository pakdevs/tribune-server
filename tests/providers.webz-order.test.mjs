import assert from 'node:assert/strict'
import test from 'node:test'
import { tryProvidersSequential } from '../lib/_providers.ts'

// GNews-only: verify provider selection is gnews and domains are handled client-side (post-normalization)
test('gnews provider returns items; domains handled post-fetch', async () => {
  const providers = [{ type: 'gnews', key: 'token_dummy' }]

  const opts = {
    page: 1,
    pageSize: 5,
    country: 'pk',
    domains: ['dawn.com'],
    sources: [],
    q: 'politics',
  }

  const fetcher = async (url, headers) => {
    if (url.includes('gnews.io')) {
      return {
        totalArticles: 1,
        articles: [
          {
            title: 'Sample',
            url: 'https://www.dawn.com/news/sample',
            source: { name: 'Dawn' },
            publishedAt: new Date().toISOString(),
          },
        ],
      }
    }
    return { totalArticles: 0, articles: [] }
  }

  const res = await tryProvidersSequential(providers, 'top', opts, fetcher)
  assert.equal(res.provider, 'gnews', 'should select gnews as provider')
  assert.ok(Array.isArray(res.items) && res.items.length === 1, 'should return mocked article')
})
