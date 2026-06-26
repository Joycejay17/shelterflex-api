import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  durableIdempotencyService,
  _resetDurableIdempotencyMemory,
} from './durableIdempotencyService.js'

describe('durableIdempotencyService', () => {
  beforeEach(() => {
    _resetDurableIdempotencyMemory()
  })

  it('executes once and replays stored result on duplicate key', async () => {
    const scope = 'payments'
    const key = 'idem-1'
    const body = { amount: 100 }
    const hash = durableIdempotencyService.payloadHash(body)

    const first = await durableIdempotencyService.start({
      scope,
      idempotencyKey: key,
      requestBodyHash: hash,
    })
    expect(first.type).toBe('proceed')

    await durableIdempotencyService.complete({
      scope,
      idempotencyKey: key,
      httpStatus: 201,
      body: { ok: true },
    })

    const second = await durableIdempotencyService.start({
      scope,
      idempotencyKey: key,
      requestBodyHash: hash,
    })
    expect(second).toEqual({ type: 'replay', httpStatus: 201, body: { ok: true } })
  })

  it('returns in_flight while first request is still processing', async () => {
    const scope = 'payments'
    const key = 'in-flight'
    const hash = durableIdempotencyService.payloadHash({ x: 1 })

    const first = await durableIdempotencyService.start({
      scope,
      idempotencyKey: key,
      requestBodyHash: hash,
    })
    expect(first.type).toBe('proceed')

    const second = await durableIdempotencyService.start({
      scope,
      idempotencyKey: key,
      requestBodyHash: hash,
    })
    expect(second.type).toBe('in_flight')
  })

  it('allows retry after failed attempt without poisoning the key', async () => {
    const scope = 'payments'
    const key = 'retry-key'
    const hash = durableIdempotencyService.payloadHash({ y: 2 })

    const first = await durableIdempotencyService.start({
      scope,
      idempotencyKey: key,
      requestBodyHash: hash,
    })
    expect(first.type).toBe('proceed')

    await durableIdempotencyService.fail({
      scope,
      idempotencyKey: key,
      message: 'transient error',
    })

    const retry = await durableIdempotencyService.start({
      scope,
      idempotencyKey: key,
      requestBodyHash: hash,
    })
    expect(retry.type).toBe('proceed')
  })

  it('scopes keys independently to prevent cross-operation collisions', async () => {
    const key = 'shared-key'
    const hash = durableIdempotencyService.payloadHash({ z: 3 })

    const a = await durableIdempotencyService.start({
      scope: 'scope-a',
      idempotencyKey: key,
      requestBodyHash: hash,
    })
    const b = await durableIdempotencyService.start({
      scope: 'scope-b',
      idempotencyKey: key,
      requestBodyHash: hash,
    })

    expect(a.type).toBe('proceed')
    expect(b.type).toBe('proceed')
  })

  it('returns conflict when same key is reused with different payload hash', async () => {
    const scope = 'payments'
    const key = 'conflict-key'

    const first = await durableIdempotencyService.start({
      scope,
      idempotencyKey: key,
      requestBodyHash: durableIdempotencyService.payloadHash({ a: 1 }),
    })
    expect(first.type).toBe('proceed')

    const conflict = await durableIdempotencyService.start({
      scope,
      idempotencyKey: key,
      requestBodyHash: durableIdempotencyService.payloadHash({ a: 2 }),
    })
    expect(conflict.type).toBe('conflict')
  })

  it('ensures at-most-once side effect under concurrent duplicate starts', async () => {
    const scope = 'payments'
    const key = 'concurrent-key'
    const hash = durableIdempotencyService.payloadHash({ n: 42 })
    let executions = 0

    const run = async () => {
      const start = await durableIdempotencyService.start({
        scope,
        idempotencyKey: key,
        requestBodyHash: hash,
      })
      if (start.type === 'replay') {
        return start
      }
      if (start.type !== 'proceed') {
        return start
      }
      executions += 1
      await durableIdempotencyService.complete({
        scope,
        idempotencyKey: key,
        httpStatus: 200,
        body: { executions },
      })
      return { type: 'proceed' as const }
    }

    const [r1, r2] = await Promise.all([run(), run()])
    const types = [r1.type, r2.type]
    expect(types.filter((t) => t === 'proceed').length).toBe(1)
    expect(executions).toBe(1)

    const replay = await durableIdempotencyService.start({
      scope,
      idempotencyKey: key,
      requestBodyHash: hash,
    })
    expect(replay.type).toBe('replay')
    expect((replay as { body: { executions: number } }).body.executions).toBe(1)
  })

  it('reclaims stale processing entries via reconcileStale', async () => {
    vi.useFakeTimers()
    const scope = 'payments'
    const key = 'stale-key'
    const hash = durableIdempotencyService.payloadHash({ stale: true })

    const first = await durableIdempotencyService.start({
      scope,
      idempotencyKey: key,
      requestBodyHash: hash,
    })
    expect(first.type).toBe('proceed')

    vi.advanceTimersByTime(16 * 60 * 1000)
    const { reclaimed } = await durableIdempotencyService.reconcileStale()
    expect(reclaimed).toBe(1)

    const retry = await durableIdempotencyService.start({
      scope,
      idempotencyKey: key,
      requestBodyHash: hash,
    })
    expect(retry.type).toBe('proceed')
    vi.useRealTimers()
  })
})
