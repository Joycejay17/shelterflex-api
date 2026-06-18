import { CircuitBreakerOpenError } from '../soroban/circuit-breaker-errors.js'
import { RpcError, isTransientRpcError } from '../soroban/errors.js'

const NETWORK_INDICATORS = [
  'timeout',
  'timed out',
  'econnrefused',
  'enotfound',
  'eai_again',
  'econnreset',
  'ehostunreach',
  'enetunreach',
] as const

/**
 * Returns true when an error represents Soroban RPC being unreachable
 * (circuit breaker open, timeout, or transient network failure).
 */
export function isChainUnavailableError(error: unknown): boolean {
  if (error instanceof CircuitBreakerOpenError) {
    return true
  }

  if (error instanceof RpcError) {
    return isTransientRpcError(error)
  }

  if (!(error instanceof Error)) {
    return false
  }

  const status =
    (error as { status?: number }).status ??
    (error as { response?: { status?: number } }).response?.status

  if (status === 503 || status === 504) {
    return true
  }

  const lowerMessage = error.message.toLowerCase()
  return NETWORK_INDICATORS.some((indicator) => lowerMessage.includes(indicator))
}
