import assert from 'assert'

export async function test() {
  process.env.BREAKER_ENABLED = '1'
  process.env.BREAKER_FAILURE_BURST = '3'
  process.env.BREAKER_OPEN_MS = '50'
  process.env.BREAKER_OPEN_MS_MAX = '200'

  const b = await import('../lib/_breaker.ts')
  b.__resetBreaker()

  const NAME = 'breaker:test'
  // Initially allow
  assert.strictEqual(b.allowRequest(NAME), true)

  // Failures below burst keep closed
  b.onFailure(NAME, 500)
  b.onFailure(NAME, 500)
  assert.strictEqual(b.allowRequest(NAME), true)

  // Trip on third failure
  b.onFailure(NAME, 500)
  assert.strictEqual(b.allowRequest(NAME), false)

  // Force half-open deterministically for test
  b.__test_only_forceHalfOpen(NAME)
  let allowed = b.allowRequest(NAME)
  assert.strictEqual(allowed, true)
  // second concurrent probe should be blocked in half-open
  assert.strictEqual(b.allowRequest(NAME), false)

  // Success closes breaker
  b.onSuccess(NAME)
  assert.strictEqual(b.allowRequest(NAME), true)

  // Trip again and test backoff growth up to max
  b.onFailure(NAME, 500)
  b.onFailure(NAME, 500)
  b.onFailure(NAME, 500)
  assert.strictEqual(b.allowRequest(NAME), false)
  const snap1 = b.getBreakerSnapshot()[NAME]
  // Force half-open again for deterministic probe
  b.__test_only_forceHalfOpen(NAME)
  allowed = b.allowRequest(NAME)
  assert.strictEqual(allowed, true)
  b.onFailure(NAME, 500) // failed probe
  const snap2 = b.getBreakerSnapshot()[NAME]
  assert(snap2.openMs >= snap1.openMs, 'backoff should not shrink')
}

export const run = test()
