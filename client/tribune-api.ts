export type Article = {
  id: string
  title: string
  summary: string
  content: string
  author: string
  publishDate: string
  category: string
  imageUrl: string
  url: string
  link: string
  sourceName: string
  sourceUrl: string
  readTime?: string
  tags?: string[]
  isBreaking?: boolean
  likes?: number
  shares?: number
}

type WorldOpts = { page?: number; pageSize?: number }
type CategoryOpts = { page?: number; pageSize?: number }
type SearchOpts = { page?: number; pageSize?: number }

const buildUrl = (baseUrl: string, path: string, params: Record<string, any> = {}) => {
  const u = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/')
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).length) u.searchParams.set(k, String(v))
  })
  return u.toString()
}

const getJsonItems = async (url: string) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err: any = new Error(`HTTP ${res.status} ${res.statusText}`)
    err.status = res.status
    err.body = text
    throw err
  }
  const json = await res.json()
  return Array.isArray(json?.items) ? (json.items as Article[]) : ([] as Article[])
}

export const createTribuneApi = (baseUrl: string) => {
  if (!baseUrl) throw new Error('baseUrl is required')

  return {
    world: ({ page = 1, pageSize = 20 }: WorldOpts = {}): Promise<Article[]> =>
      getJsonItems(buildUrl(baseUrl, '/api/world', { page, pageSize })),

    pk: ({ page = 1, pageSize = 20 }: WorldOpts = {}): Promise<Article[]> =>
      getJsonItems(buildUrl(baseUrl, '/api/pk', { page, pageSize })),

    worldCategory: (
      slug: string,
      { page = 1, pageSize = 20 }: CategoryOpts = {}
    ): Promise<Article[]> =>
      getJsonItems(
        buildUrl(baseUrl, `/api/world/category/${encodeURIComponent(slug || 'general')}`, {
          page,
          pageSize,
        })
      ),

    pkCategory: (
      slug: string,
      { page = 1, pageSize = 20 }: CategoryOpts = {}
    ): Promise<Article[]> =>
      getJsonItems(
        buildUrl(baseUrl, `/api/pk/category/${encodeURIComponent(slug || 'general')}`, {
          page,
          pageSize,
        })
      ),

    search: (q: string, { page = 1, pageSize = 20 }: SearchOpts = {}): Promise<Article[]> =>
      getJsonItems(buildUrl(baseUrl, '/api/search', { q, page, pageSize })),
  }
}

export type TribuneApi = ReturnType<typeof createTribuneApi>
