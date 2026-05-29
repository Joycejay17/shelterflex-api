import type { ConversionProvider } from './conversionProvider.js'

export interface ConversionRateResponse {
  rate: number
  source: string
  fetchedAt: string
  expiresAt: string
}

const CACHE_TTL_MS = 5 * 60 * 1000

export class ConversionRateService {
  private cache: ConversionRateResponse | null = null

  constructor(private readonly provider: ConversionProvider) {}

  async getRate(): Promise<ConversionRateResponse> {
    const now = Date.now()
    if (this.cache) {
      const expiresMs = new Date(this.cache.expiresAt).getTime()
      if (now < expiresMs) {
        return this.cache
      }
    }

    const quote = await this.provider.getRate()
    const fetchedAt = new Date(now)
    const expiresAt = new Date(now + CACHE_TTL_MS)

    this.cache = {
      rate: quote.rate,
      source: quote.source,
      fetchedAt: fetchedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }

    return this.cache
  }

  /** Clears cache (for tests). */
  clearCache(): void {
    this.cache = null
  }
}
