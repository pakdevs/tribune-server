import { purgeKey, purgePrefix } from './_cache.js'

// Simple protected purge endpoint.
// Auth: header X-Admin-Token must equal process.env.ADMIN_PURGE_TOKEN
// Usage:
//  /api/purge?key=exactKey
//  /api/purge?prefix=somePrefix
// Returns JSON { purged: number, mode: 'key'|'prefix' }
// For safety, at least one of key or prefix must be supplied (key takes precedence).
export default async function handler(req: any, res: any) {
  if (req.method && req.method !== 'GET') {
    res.statusCode = 405
    return res.end('Method Not Allowed')
  }
  const token = process.env.ADMIN_PURGE_TOKEN
  if (!token || req.headers['x-admin-token'] !== token) {
    res.statusCode = 401
    return res.end('Unauthorized')
  }
  const { key, prefix } = req.query || {}
  if (!key && !prefix) {
    res.statusCode = 400
    return res.end('Provide ?key or ?prefix')
  }
  try {
    if (key) {
      const ok = purgeKey(String(key))
      res.setHeader('Content-Type', 'application/json')
      res.statusCode = 200
      return res.end(JSON.stringify({ purged: ok ? 1 : 0, mode: 'key' }))
    }
    const count = purgePrefix(String(prefix))
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 200
    return res.end(JSON.stringify({ purged: count, mode: 'prefix' }))
  } catch (e: any) {
    res.statusCode = 500
    return res.end('Error: ' + (e?.message || 'unknown'))
  }
}
