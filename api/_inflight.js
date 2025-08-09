// Simple in-flight promise deduplication per cache key.
// Prevents simultaneous identical requests from triggering multiple upstream provider fetches.
const inflight = new Map()

export function getInFlight(key) {
  return inflight.get(key)
}

export function setInFlight(key, promise) {
  inflight.set(key, promise)
  promise.finally(() => {
    // Only delete if the same promise (avoid race if re-set before finishing)
    if (inflight.get(key) === promise) inflight.delete(key)
  })
  return promise
}
