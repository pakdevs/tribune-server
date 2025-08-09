import { cors } from './_shared.js'
import { getStats } from './_stats.js'

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ stats: getStats() })
}
