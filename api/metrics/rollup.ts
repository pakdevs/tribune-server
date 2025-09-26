import { cors } from '../../lib/_shared.js'

async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  try {
    return res.status(410).json({ error: 'metrics-disabled', message: 'Metrics removed' })
  } catch (e: any) {
    return res.status(500).json({ error: 'rollup-query-failed', message: e?.message || String(e) })
  }
}

export default handler
