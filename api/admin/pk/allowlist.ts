import { kv } from '@vercel/kv'
import { cors } from '../../../lib/_shared.js'
import { withHttpMetrics } from '../../../lib/_httpMetrics.js'
import { invalidatePkAllowlistCache, getPkAllowlistMeta } from '../../../lib/pkAllowlist.js'

function ok(res: any, body: any, status = 200) {
  res.status(status).json(body)
}

function auth(req: any) {
  const token = String(process.env.ADMIN_TOKEN || '')
  if (!token) return false
  const hdr = String(req.headers['authorization'] || '')
  if (!hdr.toLowerCase().startsWith('bearer ')) return false
  const provided = hdr.slice(7)
  return provided === token
}

export default withHttpMetrics(async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' })

  try {
    if (req.method === 'GET') {
      const meta = await getPkAllowlistMeta()
      return ok(res, { source: meta.source, list: meta.list, count: meta.list.length })
    }
    if (req.method === 'POST') {
      const body = req.body
      if (!body) return res.status(400).json({ error: 'Missing body' })
      const arr = Array.isArray(body) ? body : body?.list
      if (!Array.isArray(arr))
        return res.status(400).json({ error: 'Body must be array or {list:[]}' })
      // normalize
      const list = Array.from(
        new Set(
          arr
            .map((s: any) =>
              String(s || '')
                .toLowerCase()
                .trim()
                .replace(/^https?:\/\//, '')
                .replace(/^www\./, '')
            )
            .filter(Boolean)
        )
      )
      if (list.length > 500) return res.status(400).json({ error: 'Too many domains' })
      await kv.set('pk:allowlist', list)
      invalidatePkAllowlistCache()
      return ok(res, { saved: list.length })
    }
    if (req.method === 'DELETE') {
      await kv.del('pk:allowlist')
      invalidatePkAllowlistCache()
      return ok(res, { deleted: true })
    }
    return res.status(405).json({ error: 'Method Not Allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: 'Admin op failed', message: e?.message || String(e) })
  }
})
