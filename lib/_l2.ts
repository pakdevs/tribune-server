interface L2Provider {
  name: string
  get<T = any>(key: string): Promise<T | null>
  set<T = any>(key: string, value: T, ttlSeconds: number): Promise<void>
  available(): boolean
}

const ENABLED = String(process.env.ENABLE_L2_CACHE || '0') === '1'
const KEY_PREFIX = String(process.env.CACHE_KEY_PREFIX || '')
const DISABLE_KV = String(process.env.L2_DISABLE_KV || '0') === '1'
const TTL_MULT_ENV = parseInt(String(process.env.L2_TTL_MULT || ''), 10)
const TTL_MULT =
  Number.isFinite(TTL_MULT_ENV) && TTL_MULT_ENV >= 1 && TTL_MULT_ENV <= 10 ? TTL_MULT_ENV : 10

function applyPrefix(key: string) {
  return KEY_PREFIX ? KEY_PREFIX + key : key
}

class MemoryL2 implements L2Provider {
  name = 'memory-l2'
  store = new Map<string, { v: any; exp: number }>()
  get<T>(key: string): Promise<T | null> {
    const e = this.store.get(key)
    if (!e) return Promise.resolve(null)
    if (Date.now() > e.exp) {
      this.store.delete(key)
      return Promise.resolve(null)
    }
    return Promise.resolve(e.v as T)
  }
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const ttl = Math.max(1, Math.min(3600, ttlSeconds || 60))
    this.store.set(key, { v: value, exp: Date.now() + ttl * 1000 })
    return Promise.resolve()
  }
  available() {
    return true
  }
}

class KVProvider implements L2Provider {
  name = 'vercel-kv'
  private kv: any
  constructor(kv: any) {
    this.kv = kv
  }
  available() {
    return !!this.kv
  }
  async get<T>(key: string): Promise<T | null> {
    try {
      return (await this.kv.get(key)) as T | null
    } catch {
      return null
    }
  }
  async set<T>(key: string, value: T, ttlSeconds: number) {
    try {
      await this.kv.set(key, value, { ex: Math.max(30, Math.min(3600, ttlSeconds || 60)) })
    } catch {}
  }
}

class UpstashProvider implements L2Provider {
  name = 'upstash-redis'
  private base: string
  private token: string
  constructor(base: string, token: string) {
    this.base = base.replace(/\/$/, '')
    this.token = token
  }
  available() {
    return !!this.base && !!this.token
  }
  private authHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
    }
  }
  async get<T>(key: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.base}/get/${encodeURIComponent(key)}`, {
        headers: this.authHeaders(),
      })
      if (!res.ok) return null
      const json = await res.json().catch(() => null as any)
      if (!json || typeof json.result === 'undefined' || json.result === null) return null
      try {
        return JSON.parse(json.result) as T
      } catch {
        return json.result as T
      }
    } catch {
      return null
    }
  }
  async set<T>(key: string, value: T, ttlSeconds: number) {
    try {
      const payload = typeof value === 'string' ? value : JSON.stringify(value)
      const ttl = Math.max(30, Math.min(86400, ttlSeconds || 60))
      await fetch(
        `${this.base}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}?EX=${ttl}`,
        { method: 'POST', headers: this.authHeaders() }
      ).catch(() => {})
    } catch {}
  }
}

let providers: L2Provider[] = []
async function initProviders() {
  if (!ENABLED) return []
  if (providers.length) return providers
  providers.push(new MemoryL2())
  try {
    if (!DISABLE_KV) {
      const mod: any = await import('@vercel/kv').catch(() => null)
      if (mod?.kv) providers.push(new KVProvider(mod.kv))
    }
  } catch {}
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
  if (upstashUrl && upstashToken) {
    try {
      providers.push(new UpstashProvider(upstashUrl, upstashToken))
    } catch {}
  }
  try {
    const names = providers.map((p) => p.name)
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'l2-init',
        providers: names,
        enabled: ENABLED,
        ttlMult: TTL_MULT,
        keyPrefix: KEY_PREFIX || null,
      })
    )
    if (names.length === 1 && names[0] === 'memory-l2') {
      console.log(
        JSON.stringify({
          level: 'warn',
          msg: 'l2-degraded',
          reason: 'Only memory-l2 provider active; no distributed cache backing',
        })
      )
    }
  } catch {}
  return providers
}

export async function l2Get<T = any>(key: string): Promise<T | null> {
  if (!ENABLED) return null
  const ps = await initProviders()
  const k = applyPrefix(key)
  for (const p of ps) {
    if (!p.available()) continue
    const v = await p.get<T>(k)
    if (v !== null && v !== undefined) return v
  }
  return null
}

export async function l2Set<T = any>(key: string, value: T, ttlSeconds: number) {
  if (!ENABLED) return
  const ps = await initProviders()
  const effTtl = Math.max(1, Math.min(86400, Math.floor(ttlSeconds * TTL_MULT)))
  const k = applyPrefix(key)
  await Promise.all(
    ps.filter((p) => p.available()).map((p) => p.set(k, value, effTtl).catch(() => {}))
  )
}

export function l2Enabled() {
  return ENABLED
}

export function __l2ProviderNames() {
  return providers.map((p) => p.name)
}
