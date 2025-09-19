const inflight: Map<string, Promise<any>> = new Map()

export function getInFlight<T = any>(key: string): Promise<T> | undefined {
  return inflight.get(key) as Promise<T> | undefined
}

export function setInFlight<T = any>(key: string, promise: Promise<T>): Promise<T> {
  inflight.set(key, promise as Promise<any>)
  promise.finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key)
  })
  return promise
}
