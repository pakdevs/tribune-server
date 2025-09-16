import { cors } from '../_shared.js'
import { getRollups, summarizeRollups } from '../_rollup.js'
import { withHttpMetrics } from '../_httpMetrics.js'

async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  try {
    const token = process.env.METRICS_API_TOKEN
    if (token) {
      const auth = String(req.headers.authorization || '')
      if (auth !== `Bearer ${token}`) return res.status(401).json({ error: 'unauthorized' })
    }
    const hours = Math.min(168, Math.max(1, parseInt(String(req.query.hours || '6'), 10) || 6))
    const docs = await getRollups(hours)
    const { summary, percentiles } = summarizeRollups(docs)
    return res.status(200).json({ hours, docs, summary, percentiles })
  } catch (e: any) {
    return res.status(500).json({ error: 'rollup-query-failed', message: e?.message || String(e) })
  }
}

export default withHttpMetrics(handler)
