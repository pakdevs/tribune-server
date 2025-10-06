import { cors, cache } from '../lib/_shared.js'
import { listRegionConfigs, getRegionConfig } from '../lib/regions.js'
import type { RegionConfig, RegionFeedConfig, RegionLocalConfig } from '../lib/regions.js'

interface RequestLike {
  method?: string
  query?: Record<string, any>
}

interface ResponseLike {
  statusCode?: number
  headers?: Record<string, any>
  setHeader(key: string, value: any): void
  status(code: number): this
  json(payload: any): this
  end?(body?: any): void
}

type FeedScope = 'region' | 'local'

function stripUndefined(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    if (value === undefined) continue
    if (value === null) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
      continue
    }
    out[key] = value
  }
  return out
}

function cloneArray(value?: string[]): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.length === 0) return undefined
  return value.slice()
}

function serializeFeed(key: string, feed: RegionFeedConfig, scope: FeedScope) {
  const payload: Record<string, any> = {
    key,
    scope,
    intent: feed.intent || 'top',
  }
  if (feed.label) payload.label = feed.label
  if (feed.description) payload.description = feed.description
  if (feed.keywords) payload.keywords = feed.keywords
  const conceptUris = cloneArray(feed.conceptUris)
  if (conceptUris) payload.conceptUris = conceptUris
  const locationUris = cloneArray(feed.locationUris)
  if (locationUris) payload.locationUris = locationUris
  const sourceLocationUris = cloneArray(feed.sourceLocationUris)
  if (sourceLocationUris) payload.sourceLocationUris = sourceLocationUris
  const sourceLocationExclude = cloneArray(feed.sourceLocationExclude)
  if (sourceLocationExclude) payload.sourceLocationExclude = sourceLocationExclude
  const dataType = cloneArray(feed.dataType)
  if (dataType) payload.dataType = dataType
  if (typeof feed.forceMaxDataTimeWindow === 'number') {
    payload.forceMaxDataTimeWindow = feed.forceMaxDataTimeWindow
  }
  return payload
}

function serializeRegion(region: RegionConfig) {
  const feeds = [] as Array<Record<string, any>>
  if (region.top) feeds.push(serializeFeed('top', region.top, 'region'))
  if (region.about) feeds.push(serializeFeed('about', region.about, 'region'))
  if (region.business) feeds.push(serializeFeed('business', region.business, 'region'))

  const locals: Array<Record<string, any>> = []
  if (region.locals) {
    for (const local of Object.values(region.locals)) {
      locals.push(serializeLocal(local))
    }
  }

  const payload: Record<string, any> = {
    key: region.key,
    label: region.label,
    feeds,
  }
  if (region.description) payload.description = region.description
  const defaults = stripUndefined({
    country: region.defaultCountry,
    language: region.defaultLanguage,
  })
  if (Object.keys(defaults).length) payload.defaults = defaults
  if (locals.length) payload.locals = locals
  return payload
}

function serializeLocal(local: RegionLocalConfig) {
  const payload = serializeFeed(local.key, local, 'local')
  if (!payload.label) payload.label = local.label
  return payload
}

function buildRegionsPayload(configs: RegionConfig[]) {
  return configs.map((region) => serializeRegion(region))
}

function methodNotAllowed(res: ResponseLike) {
  res.setHeader('Allow', 'GET, OPTIONS')
  return res.status(405).json({ error: 'Method Not Allowed' })
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  cors(res as any)
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS')
    return res.status(204).end?.()
  }
  if (req.method !== 'GET') {
    return methodNotAllowed(res)
  }

  const regionParam = req.query?.region ? String(req.query.region).trim().toLowerCase() : ''
  let configs: RegionConfig[]
  if (regionParam) {
    const found = getRegionConfig(regionParam)
    if (!found) {
      return res.status(404).json({ error: 'Unknown region', region: regionParam })
    }
    configs = [found]
  } else {
    configs = listRegionConfigs()
  }

  const response = { regions: buildRegionsPayload(configs) }
  res.setHeader('X-Regions-Count', String(response.regions.length))
  cache(res as any, 3600, 300)
  return res.status(200).json(response)
}
