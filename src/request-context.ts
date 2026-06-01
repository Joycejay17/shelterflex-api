import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestContextStore = {
  requestId: string
  queryCount: number
}

export const requestContext = new AsyncLocalStorage<RequestContextStore>()

export function getRequestContext(): RequestContextStore | undefined {
  return requestContext.getStore()
}

export function incrementRequestQueryCount(): void {
  const store = requestContext.getStore()
  if (store) {
    store.queryCount += 1
  }
}
