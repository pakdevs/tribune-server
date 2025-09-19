const map = new Map<string, number>()

export function setCooldown(key: string, seconds: number) {
  const until = Date.now() + Math.max(0, seconds) * 1000
  map.set(key, until)
}

export function getCooldownRemaining(key: string): number {
  const until = map.get(key) || 0
  return Math.max(0, until - Date.now())
}

export function isCoolingDown(key: string): boolean {
  return getCooldownRemaining(key) > 0
}
