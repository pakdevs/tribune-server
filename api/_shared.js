export function cors(res) {
  // Consider locking origin in production by checking process.env.ALLOW_ORIGIN
  const allow = process.env.ALLOW_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', allow)
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  // Basic security hardening headers (lightweight)
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

export function cache(res, seconds = 300, swr = 60) {
  res.setHeader('Cache-Control', `s-maxage=${seconds}, stale-while-revalidate=${swr}`)
}

export async function upstreamJson(url, headers = {}) {
  const r = await fetch(url, { headers })
  if (!r.ok) throw new Error(`Upstream ${r.status}`)
  return r.json()
}
