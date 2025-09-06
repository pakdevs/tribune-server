export function cors(res: any) {
  const allow = (process as any)?.env?.ALLOW_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', allow)
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader(
    'Permissions-Policy',
    [
      'geolocation=()',
      'camera=()',
      'microphone=()',
      'payment=()',
      'accelerometer=()',
      'gyroscope=()',
      'magnetometer=()',
    ].join(', ')
  )
}

export function cache(res: any, seconds = 300, swr = 60) {
  const s = Number((process as any)?.env?.CACHE_SMAXAGE ?? seconds)
  const w = Number((process as any)?.env?.CACHE_SWR ?? swr)
  res.setHeader(
    'Cache-Control',
    `s-maxage=${Number.isFinite(s) ? s : seconds}, stale-while-revalidate=${
      Number.isFinite(w) ? w : swr
    }`
  )
}

export async function upstreamJson(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 8000
) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const r = await fetch(url, { headers, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId)
  )
  if (!r.ok) {
    const err: any = new Error(`Upstream ${r.status}`)
    err.status = r.status
    const ra = r.headers.get('retry-after')
    if (ra) err.retryAfter = ra
    throw err
  }
  return r.json()
}
