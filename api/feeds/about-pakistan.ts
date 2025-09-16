import { cors, cache } from '../_shared.js'
import handlerPK from '../pk.js'
import { withHttpMetrics } from '../_httpMetrics.js'

async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  // Rewrite query to force scope=about, preserve page and passthrough flags
  req.query = {
    ...req.query,
    scope: 'about',
  }
  // Delegate to existing PK handler
  return handlerPK(req, res)
}

export default withHttpMetrics(handler)
