/**
 * Tribune API client for React Native / Web.
 * Usage:
 *   import { createTribuneApi } from './tribune-api'
 *   const api = createTribuneApi('https://<your-domain>.vercel.app')
 *   const items = await api.world({ page: 1, pageSize: 20 })
 */

/**
 * @typedef {Object} Article
 * @property {string} id
 * @property {string} title
 * @property {string} summary
 * @property {string} content
 * @property {string} author
 * @property {string} publishDate
 * @property {string} category
 * @property {string} imageUrl
 * @property {string} url
 * @property {string} link
 * @property {string} sourceName
 * @property {string} sourceUrl
 * @property {string=} readTime
 * @property {string[]=} tags
 * @property {boolean=} isBreaking
 * @property {number=} likes
 * @property {number=} shares
 */

/** Build a full URL with query params */
const buildUrl = (baseUrl, path, params = {}) => {
  const u = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/')
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).length) u.searchParams.set(k, String(v))
  })
  return u.toString()
}

/** Minimal GET helper that returns `items` or throws */
const getJsonItems = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`HTTP ${res.status} ${res.statusText}`)
    err.status = res.status
    err.body = text
    throw err
  }
  const json = await res.json()
  return Array.isArray(json?.items) ? json.items : []
}

/**
 * Create a client bound to a base URL.
 * @param {string} baseUrl e.g. https://tribune-server-xxxx.vercel.app
 */
export const createTribuneApi = (baseUrl) => {
  if (!baseUrl) throw new Error('baseUrl is required')

  return {
    /** @returns {Promise<Article[]>} */
    world: ({ page = 1, pageSize = 20 } = {}) =>
      getJsonItems(buildUrl(baseUrl, '/api/world', { page, pageSize })),

    /** @returns {Promise<Article[]>} */
    pk: ({ page = 1, pageSize = 20 } = {}) =>
      getJsonItems(buildUrl(baseUrl, '/api/pk', { page, pageSize })),

    /** @returns {Promise<Article[]>} */
    worldCategory: (slug, { page = 1, pageSize = 20 } = {}) =>
      getJsonItems(
        buildUrl(baseUrl, `/api/world/category/${encodeURIComponent(slug || 'general')}`, {
          page,
          pageSize,
        })
      ),

    /** @returns {Promise<Article[]>} */
    pkCategory: (slug, { page = 1, pageSize = 20 } = {}) =>
      getJsonItems(
        buildUrl(baseUrl, `/api/pk/category/${encodeURIComponent(slug || 'general')}`, {
          page,
          pageSize,
        })
      ),

    /** @returns {Promise<Article[]>} */
    search: (q, { page = 1, pageSize = 20 } = {}) =>
      getJsonItems(buildUrl(baseUrl, '/api/search', { q, page, pageSize })),
  }
}

// Optional: tiny wrapper for RN to open the article link
// Example usage:
//   import { Linking } from 'react-native'
//   const openArticle = (item) => Linking.openURL(item.url || item.link)
