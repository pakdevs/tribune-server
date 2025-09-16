import { cors } from './_shared.js'
import { getStats } from './_stats.js'
import { withHttpMetrics } from './_httpMetrics.js'

async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ stats: getStats() })
}

export default withHttpMetrics(handler)
