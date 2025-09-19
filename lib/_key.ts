function sortArray(arr: any[] | undefined | null): string[] | undefined {
  if (!Array.isArray(arr)) return undefined
  return arr
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v).trim())
    .filter((s) => s.length)
    .map((s) => s.toLowerCase())
    .sort()
}

export interface KeyParams {
  [k: string]: any
}

export function canonicalizeParams(params: KeyParams): KeyParams {
  const out: KeyParams = {}
  const keys = Object.keys(params || {}).sort()
  for (const k of keys) {
    const v = (params as any)[k]
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      const sorted = sortArray(v)
      if (!sorted || !sorted.length) continue
      // De-duplicate after sorting
      const dedup: string[] = []
      let last: string | undefined
      for (const s of sorted) {
        if (s !== last) dedup.push(s)
        last = s
      }
      out[k] = dedup
    } else if (typeof v === 'string') {
      const trimmed = v.trim()
      if (!trimmed) continue
      out[k] = trimmed.toLowerCase()
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v
    } else {
      // For nested objects, JSON stringify deterministically by sorted keys
      if (typeof v === 'object') {
        const nested = canonicalizeParams(v)
        if (Object.keys(nested).length) out[k] = nested
      }
    }
  }
  return out
}

function encodeValue(v: any): string {
  if (Array.isArray(v)) return v.join(',')
  if (typeof v === 'object' && v)
    return Object.keys(v)
      .map((k) => `${k}=${encodeValue(v[k])}`)
      .join('&')
  return String(v)
}

export function buildCacheKey(prefix: string, raw: KeyParams): string {
  const c = canonicalizeParams(raw)
  const parts: string[] = [`v1`, prefix]
  for (const k of Object.keys(c)) {
    parts.push(`${k}=${encodeValue((c as any)[k])}`)
  }
  return parts.join('|')
}

export function shortHashKey(longKey: string): string {
  let h = 0
  for (let i = 0; i < longKey.length; i++) h = (h * 31 + longKey.charCodeAt(i)) >>> 0
  return 'k' + h.toString(36)
}
