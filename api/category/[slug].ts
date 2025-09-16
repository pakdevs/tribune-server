import { cors } from '../_shared.js'
import { withHttpMetrics } from '../_httpMetrics.js'

// Deprecated: this route is removed. Use /api/world/category/[slug]
async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  res.statusCode = 410
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  return res.end(JSON.stringify({ error: 'Gone', message: 'Use /api/world/category/[slug]' }))
}

export default withHttpMetrics(handler)
