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
  res.setHeader('Cache-Control', `s-maxage=${seconds}, stale-while-revalidate=${swr}`)
}

export async function upstreamJson(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers })
  if (!r.ok) throw new Error(`Upstream ${r.status}`)
  return r.json()
}
