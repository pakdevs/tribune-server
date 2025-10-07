import { buildPakistanOrQuery, PK_BUSINESS_CONCEPT_URIS } from './pkTerms.js'

export interface RegionFeedConfig {
  label?: string
  description?: string
  keywords?: string
  conceptUris?: string[]
  locationUris?: string[]
  sourceLocationUris?: string[]
  sourceLocationExclude?: string[]
  dataType?: string[]
  forceMaxDataTimeWindow?: number
  intent?: 'top' | 'search'
}

export interface RegionLocalConfig extends RegionFeedConfig {
  key: string
  label: string
}

export interface RegionConfig {
  key: string
  label: string
  defaultLanguage?: string
  defaultCountry?: string
  top: RegionFeedConfig
  about?: RegionFeedConfig
  business?: RegionFeedConfig
  locals?: Record<string, RegionLocalConfig>
  description?: string
}

const LOCATION_URIS = {
  pakistan: 'http://en.wikipedia.org/wiki/Pakistan',
  world: 'http://en.wikipedia.org/wiki/World',
  karachi: 'http://en.wikipedia.org/wiki/Karachi',
  lahore: 'http://en.wikipedia.org/wiki/Lahore',
  islamabad: 'http://en.wikipedia.org/wiki/Islamabad',
  unitedStates: 'http://en.wikipedia.org/wiki/United_States',
  newYorkCity: 'http://en.wikipedia.org/wiki/New_York_City',
  losAngeles: 'http://en.wikipedia.org/wiki/Los_Angeles',
  chicago: 'http://en.wikipedia.org/wiki/Chicago',
}

type RegionConfigMap = Record<string, RegionConfig>

export const REGION_CONFIGS: RegionConfigMap = {
  pakistan: {
    key: 'pakistan',
    label: 'Pakistan',
    defaultLanguage: 'eng',
    defaultCountry: 'pk',
    description: 'National and business-focused coverage centered on Pakistan.',
    top: {
      keywords: buildPakistanOrQuery(16),
      locationUris: [LOCATION_URIS.pakistan],
      sourceLocationUris: [LOCATION_URIS.pakistan],
      dataType: ['news'],
      intent: 'top',
    },
    about: {
      keywords: buildPakistanOrQuery(20),
      conceptUris: [],
      locationUris: [LOCATION_URIS.pakistan],
      sourceLocationUris: [LOCATION_URIS.pakistan],
      dataType: ['news'],
      description: 'Articles about Pakistan from global sources.',
      intent: 'search',
    },
    business: {
      keywords: buildPakistanOrQuery(12),
      conceptUris: PK_BUSINESS_CONCEPT_URIS,
      locationUris: [LOCATION_URIS.pakistan],
      sourceLocationUris: [LOCATION_URIS.pakistan],
      dataType: ['news'],
      forceMaxDataTimeWindow: 72,
      description: 'Business and economy coverage related to Pakistan.',
      intent: 'search',
    },
    locals: {
      karachi: {
        key: 'karachi',
        label: 'Karachi',
        keywords: 'karachi',
        locationUris: [LOCATION_URIS.karachi],
        sourceLocationUris: [LOCATION_URIS.pakistan],
        dataType: ['news'],
        description: 'City-level news focused on Karachi.',
        intent: 'search',
      },
      lahore: {
        key: 'lahore',
        label: 'Lahore',
        keywords: 'lahore',
        locationUris: [LOCATION_URIS.lahore],
        sourceLocationUris: [LOCATION_URIS.pakistan],
        dataType: ['news'],
        description: 'City-level news focused on Lahore.',
        intent: 'search',
      },
      islamabad: {
        key: 'islamabad',
        label: 'Islamabad',
        keywords: 'islamabad',
        locationUris: [LOCATION_URIS.islamabad],
        sourceLocationUris: [LOCATION_URIS.pakistan],
        dataType: ['news'],
        description: 'City-level news focused on Islamabad.',
        intent: 'search',
      },
    },
  },
  world: {
    key: 'world',
    label: 'World',
    defaultLanguage: 'eng',
    description:
      'Global top stories. Country parameter should be supplied at runtime to scope coverage.',
    top: {
      dataType: ['news'],
      locationUris: [],
      intent: 'top',
    },
  },
  'united-states': {
    key: 'united-states',
    label: 'United States',
    defaultLanguage: 'eng',
    defaultCountry: 'us',
    description: 'National coverage for the United States with optional local city feeds.',
    top: {
      dataType: ['news'],
      locationUris: [LOCATION_URIS.unitedStates],
      intent: 'top',
    },
    business: {
      keywords: 'United States economy OR US economy OR Wall Street',
      locationUris: [LOCATION_URIS.unitedStates],
      sourceLocationUris: [LOCATION_URIS.unitedStates],
      dataType: ['news'],
      intent: 'search',
      description: 'Business and market headlines centered on the US economy.',
      forceMaxDataTimeWindow: 72,
    },
    locals: {
      'new-york': {
        key: 'new-york',
        label: 'New York City',
        keywords: 'New York City OR NYC',
        locationUris: [LOCATION_URIS.newYorkCity],
        sourceLocationUris: [LOCATION_URIS.newYorkCity],
        dataType: ['news'],
        description: 'City coverage from New York-focused outlets.',
        intent: 'search',
      },
      'los-angeles': {
        key: 'los-angeles',
        label: 'Los Angeles',
        keywords: 'Los Angeles OR LA',
        locationUris: [LOCATION_URIS.losAngeles],
        sourceLocationUris: [LOCATION_URIS.losAngeles],
        dataType: ['news'],
        description: 'Stories from the greater Los Angeles area.',
        intent: 'search',
      },
      chicago: {
        key: 'chicago',
        label: 'Chicago',
        keywords: 'Chicago',
        locationUris: [LOCATION_URIS.chicago],
        sourceLocationUris: [LOCATION_URIS.chicago],
        dataType: ['news'],
        description: 'Local headlines from Chicago and surrounding communities.',
        intent: 'search',
      },
    },
  },
  'middle-east': {
    key: 'middle-east',
    label: 'Middle East',
    defaultLanguage: 'eng',
    description: 'Regional hub for Middle East coverage with flexible source filters.',
    top: {
      keywords: 'Middle East',
      conceptUris: ['http://en.wikipedia.org/wiki/Middle_East'],
      dataType: ['news'],
      forceMaxDataTimeWindow: 96,
      intent: 'search',
    },
  },
}

export type RegionFeedKey = 'top' | 'about' | 'business'

export interface ResolveRegionFeedOptions {
  feed?: string
  local?: string
}

export interface ResolvedRegionFeed {
  region: RegionConfig
  feedKey: string
  feed: RegionFeedConfig
  intent: 'top' | 'search'
  local?: RegionLocalConfig
}

function normalizeKey(input?: string) {
  return String(input || '')
    .trim()
    .toLowerCase()
}

function pickFeedFromRegion(region: RegionConfig, feedKey: string): [string, RegionFeedConfig] {
  const fallbackKey: RegionFeedKey = 'top'
  const normalized = normalizeKey(feedKey)
  const candidates: Array<[string, RegionFeedConfig | undefined]> = [
    [normalized, undefined],
    [fallbackKey, region.top],
  ]
  if (normalized === 'top') candidates[0][1] = region.top
  else if (normalized === 'about') candidates[0][1] = region.about
  else if (normalized === 'business') candidates[0][1] = region.business
  for (const [key, feed] of candidates) {
    if (feed) return [key, feed]
  }
  throw new Error(`Region ${region.key} is missing feed configuration`)
}

export function resolveRegionFeed(
  regionKey: string,
  options: ResolveRegionFeedOptions = {}
): ResolvedRegionFeed {
  const region = requireRegionConfig(regionKey)
  const localKey = options.local ? normalizeKey(options.local) : ''
  if (localKey) {
    const locals = region.locals || {}
    const local = locals[localKey]
    if (!local) throw new Error(`Unknown local "${localKey}" for region ${region.key}`)
    return {
      region,
      feedKey: `local:${local.key}`,
      feed: local,
      intent: local.intent || 'search',
      local,
    }
  }
  const [feedKey, feed] = pickFeedFromRegion(region, options.feed || 'top')
  return {
    region,
    feedKey,
    feed,
    intent: feed.intent || 'top',
  }
}

export interface RegionProviderOverrideOptions {
  page?: number
  pageSize?: number
  country?: string
  language?: string
  q?: string
  domains?: string[]
  sources?: string[]
  pageToken?: string
}

export function buildProviderOptionsFromRegion(
  resolved: ResolvedRegionFeed,
  overrides: RegionProviderOverrideOptions = {}
) {
  const { region, feed } = resolved
  const cleanArray = (value?: string[]) => (Array.isArray(value) ? value.slice() : undefined)
  const opts: Record<string, any> = {
    page: overrides.page,
    pageSize: overrides.pageSize,
    country: overrides.country ?? region.defaultCountry,
    language: overrides.language ?? region.defaultLanguage,
    q: overrides.q ?? feed.keywords,
    domains: overrides.domains,
    sources: overrides.sources,
    pageToken: overrides.pageToken,
    conceptUris: cleanArray(feed.conceptUris),
    locationUris: cleanArray(feed.locationUris),
    sourceLocationUris: cleanArray(feed.sourceLocationUris),
    sourceLocationExclude: cleanArray(feed.sourceLocationExclude),
    dataType: cleanArray(feed.dataType),
    forceMaxDataTimeWindow: feed.forceMaxDataTimeWindow,
  }
  const normalized: Record<string, any> = {}
  for (const key of Object.keys(opts)) {
    const value = opts[key]
    if (value !== undefined && value !== null) {
      if (Array.isArray(value) && value.length === 0) continue
      normalized[key] = value
    }
  }
  return normalized
}

export function listRegionConfigs(): RegionConfig[] {
  return Object.values(REGION_CONFIGS)
}

export function getRegionConfig(key: string): RegionConfig | undefined {
  const normalized = normalizeKey(key)
  if (!normalized) return undefined
  return REGION_CONFIGS[normalized]
}

export function requireRegionConfig(key: string): RegionConfig {
  const found = getRegionConfig(key)
  if (!found) {
    throw new Error(`Unknown region config: ${key}`)
  }
  return found
}
