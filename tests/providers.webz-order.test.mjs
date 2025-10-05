import assert from 'node:assert/strict'
import test from 'node:test'
import { tryProvidersSequential } from '../lib/_providers.ts'

// NewsAPI.ai-only: verify provider selection is newsapi-ai and domains are handled client-side
test('newsapi-ai provider returns items; domains handled post-fetch', async () => {
  const providers = [{ type: 'newsapi-ai', key: 'token_dummy' }]

  const opts = {
    page: 1,
    pageSize: 5,
    country: 'pk',
    domains: ['dawn.com'],
    sources: [],
    q: 'politics',
  }

  const fetcher = async (request) => {
    assert.equal(request.method, 'POST')
    const body = JSON.parse(request.body)
    assert.equal(body.apiKey, 'token_dummy')
    assert.equal(body.resultType, 'articles')
    assert.equal(body.articlesCount, 5)
    assert.equal(body.articlesPage, 1)
    assert.equal(body.articlesSortBy, 'sourceImportance')
    assert.equal(body.includeArticleTitle, true)
    assert.equal(body.dataType[0], 'news')
    assert.equal(body.query.$filter.lang[0], 'eng')
    if (request.url.includes('newsapi.ai')) {
      return {
        articles: [
          {
            title: 'Sample',
            url: 'https://www.dawn.com/news/sample',
            source: { title: 'Dawn' },
            dateTimePub: new Date().toISOString(),
          },
        ],
      }
    }
    return { totalArticles: 0, articles: [] }
  }

  const res = await tryProvidersSequential(providers, 'top', opts, fetcher)
  assert.equal(res.provider, 'newsapi-ai', 'should select newsapi-ai as provider')
  assert.ok(Array.isArray(res.items) && res.items.length === 1, 'should return mocked article')
})
