export default function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  res.statusCode = 410
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  return res.end(JSON.stringify({ error: 'Gone', message: 'stats endpoint removed' }))
}
