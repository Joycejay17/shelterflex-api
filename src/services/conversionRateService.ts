import type { ConversionProvider } from './conversionProvider.js'
import { ConversionProviderError } from './conversionProvider.js'

export interface ConversionRateResponse {
  rate: number
  source: string
  fetchedAt: string
  expiresAt: string
  isStale?: boolean
}

export interface ConversionRateServiceOptions {
  /** Cache TTL in milliseconds. Default: 5 minutes */
  cacheTtlMs?: number
  /** Hard staleness limit in milliseconds. Rates older than this are rejected. Default: 15 minutes */
  hardStalenessMs?: number
  /** Minimum acceptable rate (sanity bound). Default: 100 */
  minRate?: number
  /** Maximum acceptable rate (sanity bound). Default: 10000 */
  maxRate?: number
  /** Injected clock for testing. Default: Date.now */
  clock?: () => number
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_HARD_STALENESS_MS = 15 * 60 * 1000
const DEFAULT_MIN_RATE = 100
const DEFAULT_MAX_RATE = 10_000

export class ConversionRateService {
  private cache: ConversionRateResponse | null = null

  constructor(
    private readonly provider: ConversionProvider,
    private readonly options: ConversionRateServiceOptions = {},
  ) {}

  private getClock(): number {
    return this.options.clock?.() ?? Date.now()
  }

  private getCacheTtlMs(): number {
    return this.options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  }

  private getHardStalenessMs(): number {
    return this.options.hardStalenessMs ?? DEFAULT_HARD_STALENESS_MS
  }

  private getMinRate(): number {
    return this.options.minRate ?? DEFAULT_MIN_RATE
  }

  private getMaxRate(): number {
    return this.options.maxRate ?? DEFAULT_MAX_RATE
  }

  private validateRateBounds(rate: number): void {
    if (rate <= 0) {
      throw new ConversionProviderError('Rate must be positive', 'INVALID_RESPONSE')
    }
    if (!Number.isFinite(rate)) {
      throw new ConversionProviderError('Rate must be finite', 'INVALID_RESPONSE')
    }
    const min = this.getMinRate()
    const max = this.getMaxRate()
    if (rate < min || rate > max) {
      throw new ConversionProviderError(
        `Rate ${rate} is outside acceptable bounds [${min}, ${max}]`,
        'INVALID_RESPONSE',
      )
    }
  }

  private checkHardStaleness(fetchedAt: string): void {
    const now = this.getClock()
    const fetchedMs = new Date(fetchedAt).getTime()
    const age = now - fetchedMs
    const hardLimit = this.getHardStalenessMs()

    if (age > hardLimit) {
      throw new ConversionProviderError(
        `Rate is too stale: ${age}ms old, hard limit is ${hardLimit}ms`,
        'INVALID_RESPONSE',
      )
    }
  }

  async getRate(): Promise<ConversionRateResponse> {
    const now = this.getClock()

    // Check cache first
    if (this.cache) {
      const expiresMs = new Date(this.cache.expiresAt).getTime()
      if (now < expiresMs) {
        // Cache hit - return cached rate
        return this.cache
      }

      // Cache expired - check staleness
      const fetchedMs = new Date(this.cache.fetchedAt).getTime()
      const age = now - fetchedMs
      const hardLimit = this.getHardStalenessMs()

      if (age > hardLimit) {
        // Beyond hard staleness limit - reject
        this.checkHardStaleness(this.cache.fetchedAt)
      }

      // Within hard staleness limit - mark as stale and try to refresh
      try {
        const quote = await this.provider.getRate()
        this.validateRateBounds(quote.rate)

        const fetchedAt = new Date(now)
        const expiresAt = new Date(now + this.getCacheTtlMs())

        this.cache = {
          rate: quote.rate,
          source: quote.source,
          fetchedAt: fetchedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        }

        return this.cache
      } catch (error) {
        // Provider failed - return stale cache
        return { ...this.cache, isStale: true }
      }
    }

    // Cache miss - fetch fresh rate
    try {
      const quote = await this.provider.getRate()

      // Validate rate bounds
      this.validateRateBounds(quote.rate)

      const fetchedAt = new Date(now)
      const expiresAt = new Date(now + this.getCacheTtlMs())

      this.cache = {
        rate: quote.rate,
        source: quote.source,
        fetchedAt: fetchedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }

      return this.cache
    } catch (error) {
      // No cache available - rethrow
      throw error
    }
  }

  /** Clears cache (for tests). */
  clearCache(): void {
    this.cache = null
  }
}
