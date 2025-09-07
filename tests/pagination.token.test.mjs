import assert from 'node:assert/strict'
import test from 'node:test'
import { tryProvidersSequential } from '../api/_providers.ts'

test('passes pageToken to NewsData request when provided', async () => {
  const providers = [{ type: 'newsdata', key: 'pub_dummy' }]
  const opts = { page: 2, pageSize: 10, country: 'pk', pageToken: 'abc123' }
  let capturedUrl = ''
  const fetcher = async (url) => {
    capturedUrl = url
    return { status: 'success', results: [{ title: 'ok', url: 'https://dawn.com/x' }] }
  }
  const res = await tryProvidersSequential(providers, 'top', opts, fetcher)
  assert.equal(res.provider, 'newsdata')
  assert.ok(capturedUrl.includes('newsdata.io'), 'should call newsdata endpoint')
  assert.ok(
    capturedUrl.includes('page=abc123') || capturedUrl.includes('pageToken=abc123'),
    'should include page token in request'
  )
  assert.ok(Array.isArray(res.items) && res.items.length === 1)
})
