import { getRollups, summarizeRollups } from './_rollup.js'

interface SLOConfig {
  http5xxErrorBudget: number // allowed 5xx ratio (e.g. 0.01 = 1%)
  httpLatencyP95Ms: number // desired p95 latency budget
  upstreamErrorBudget: number // upstream error+timeout ratio budget
  evaluationHours: number // how many hours to consider when evaluating
}

function cfg(): SLOConfig {
  return {
    http5xxErrorBudget: Number(process.env.SLO_HTTP_5XX_BUDGET || '0.01'),
    httpLatencyP95Ms: Number(process.env.SLO_HTTP_P95_MS || '1200'),
    upstreamErrorBudget: Number(process.env.SLO_UPSTREAM_ERROR_BUDGET || '0.05'),
    evaluationHours: Math.min(24, Math.max(1, Number(process.env.SLO_EVAL_HOURS || '6'))),
  }
}

// Evaluate and log if burn is high. Called periodically by loop below.
export async function evaluateSLOs() {
  const c = cfg()
  const docs = await getRollups(c.evaluationHours)
  const { summary, percentiles } = summarizeRollups(docs)
  const totalHttp = Object.values(summary.httpStatus).reduce((a, b) => a + b, 0) || 1
  const http5xx = summary.httpStatus['5xx'] || 0
  const http429 = summary.httpStatus['429'] || 0
  const http4xx = summary.httpStatus['4xx'] || 0
  const http304 = summary.httpStatus['304'] || 0
  const http200 = summary.httpStatus['200'] || 0
  const p95 = percentiles.http[95]
  const upTotal = summary.upstream.ok + summary.upstream.error + summary.upstream.timeout || 1
  const upErr = summary.upstream.error + summary.upstream.timeout

  const ratio5xx = http5xx / totalHttp
  const ratioUpErr = upErr / upTotal
  const alerts: any[] = []
  if (ratio5xx > c.http5xxErrorBudget) {
    alerts.push({
      type: 'http-5xx',
      ratio: Number(ratio5xx.toFixed(4)),
      budget: c.http5xxErrorBudget,
    })
  }
  if (p95 > c.httpLatencyP95Ms) {
    alerts.push({ type: 'http-latency-p95', p95, budget: c.httpLatencyP95Ms })
  }
  if (ratioUpErr > c.upstreamErrorBudget) {
    alerts.push({
      type: 'upstream-error',
      ratio: Number(ratioUpErr.toFixed(4)),
      budget: c.upstreamErrorBudget,
    })
  }
  if (alerts.length) {
    try {
      const payload = {
        level: 'warn',
        msg: 'slo-burn',
        evalHours: c.evaluationHours,
        alerts,
        http: {
          total: totalHttp,
          fiveXX: http5xx,
          fourXX: http4xx,
          two00: http200,
          three04: http304,
        },
        upstream: summary.upstream,
        p95,
      }
      console.log(JSON.stringify(payload))
    } catch {}
  }
  return { alerts }
}

let started = false
export function ensureSLOLoop() {
  if (started) return
  started = true
  const enable = String(process.env.SLO_ENABLE || '1') === '1'
  if (!enable) return
  const run = async () => {
    try {
      await evaluateSLOs()
    } catch {}
    const interval = Math.max(60_000, Number(process.env.SLO_EVAL_INTERVAL_MS || '300000'))
    const h: any = setTimeout(run, interval)
    if (typeof h?.unref === 'function') h.unref()
  }
  run()
}

// Auto start when imported
ensureSLOLoop()
