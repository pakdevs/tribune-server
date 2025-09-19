type ProviderBudget = {
  day: string
  used: number
}

const budgets: Record<string, ProviderBudget> = {}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function ensure(name: string): ProviderBudget {
  const day = todayKey()
  const cur = budgets[name]
  if (!cur || cur.day !== day) {
    budgets[name] = { day, used: 0 }
  }
  return budgets[name]
}

export function getUsedToday(name: string) {
  return ensure(name).used
}

export function spend(name: string, count = 1) {
  const b = ensure(name)
  b.used += Math.max(1, count)
}

export function canSpend(name: string, dailyLimit: number, cost = 1) {
  const used = getUsedToday(name)
  const would = used + Math.max(1, cost)
  if (!Number.isFinite(dailyLimit) || dailyLimit <= 0) return { ok: true }
  if (would > dailyLimit) return { ok: false, reason: `daily-limit(${used}/${dailyLimit})` }
  return { ok: true }
}

export function getBudgetSnapshot() {
  const day = todayKey()
  const snap: Record<string, number> = {}
  for (const k of Object.keys(budgets)) {
    const b = budgets[k]
    snap[k] = b.day === day ? b.used : 0
  }
  return { day, used: snap }
}
