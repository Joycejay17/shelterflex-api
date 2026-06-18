import { describe, it, expect } from 'vitest'
import { CircuitBreakerOpenError } from '../soroban/circuit-breaker-errors.js'
import { RpcError } from '../soroban/errors.js'
import { isChainUnavailableError } from './chainUnavailable.js'

describe('isChainUnavailableError', () => {
  it('returns true for circuit breaker open errors', () => {
    const error = new CircuitBreakerOpenError(
      {
        state: 'OPEN',
        consecutiveFailures: 3,
        totalAttempts: 3,
        totalSuccesses: 0,
        totalFailures: 3,
        lastStateTransitionTime: new Date(),
        openedAt: new Date(),
        halfOpenTestRequestsRemaining: 0,
      },
      'getBalance',
      'Circuit breaker is OPEN',
    )

    expect(isChainUnavailableError(error)).toBe(true)
  })

  it('returns true for RPC timeout errors', () => {
    expect(isChainUnavailableError(new Error('RPC request timed out after 30000ms'))).toBe(true)
  })

  it('returns true for transient RpcError responses', () => {
    expect(isChainUnavailableError(new RpcError('Gateway timeout', 504))).toBe(true)
  })

  it('returns false for permanent contract errors', () => {
    expect(isChainUnavailableError(new Error('Insufficient balance: 0 < 100'))).toBe(false)
  })
})
