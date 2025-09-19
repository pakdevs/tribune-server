// Phase 7 helper: Wrap API handlers to record HTTP status + latency without manual edits.
// Usage: export default withHttpMetrics(async function handler(req,res){ ... })
// Relies on dynamic import of _metrics to avoid cost if metrics disabled.

export function withHttpMetrics(fn: (req: any, res: any) => any | Promise<any>) {
  return async function wrapped(req: any, res: any) {
    const start = Date.now()
    let statusCode: number | undefined
    let recorded = false

    const finalize = () => {
      if (recorded) return
      recorded = true
      const code = typeof statusCode === 'number' ? statusCode : res.statusCode || 200
      const latency = Date.now() - start
      import('./_metrics.js').then((m) => m.recordHttp(code, latency)).catch(() => {})
    }

    const origStatus = res.status?.bind(res)
    if (origStatus) {
      res.status = (code: number) => {
        statusCode = code
        return origStatus(code)
      }
    }
    const origEnd = res.end?.bind(res)
    if (origEnd) {
      res.end = function (...args: any[]) {
        try {
          finalize()
        } catch {}
        return origEnd(...(args as any))
      }
    }
    const origJson = res.json?.bind(res)
    if (origJson) {
      res.json = function (...args: any[]) {
        try {
          finalize()
        } catch {}
        return origJson(...(args as any))
      }
    }
    try {
      const out = await fn(req, res)
      finalize()
      return out
    } catch (e: any) {
      if (!recorded) {
        if (statusCode == null) statusCode = e?.status || 500
        finalize()
      }
      throw e
    }
  }
}
