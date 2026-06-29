import { describe, it, expect, vi } from 'vitest'
import { ConversionRateService } from './conversionRateService.js'
import { ConversionProviderError, StubConversionProvider } from './conversionProvider.js'

describe('ConversionRateService', () => {
  const BASE_RATE = 1600
  const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
  const HARD_STALENESS_MS = 15 * 60 * 1000 // 15 minutes

  describe('caching and TTL refresh', () => {
    it('fetches fresh rate on first call', async () => {
      const provider = new StubConversionProvider(BASE_RATE)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, { clock, cacheTtlMs: CACHE_TTL_MS })
      const getRateSpy = vi.spyOn(provider, 'getRate')

      const result = await service.getRate()

      expect(result.rate).toBe(BASE_RATE)
      expect(result.source).toBe('stub')
      expect(result.isStale).toBeUndefined()
      expect(getRateSpy).toHaveBeenCalledTimes(1)
    })

    it('returns cached rate within TTL (no upstream call)', async () => {
      const provider = new StubConversionProvider(BASE_RATE)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, { clock, cacheTtlMs: CACHE_TTL_MS })
      const getRateSpy = vi.spyOn(provider, 'getRate')

      // First call - fetches
      await service.getRate()
      expect(getRateSpy).toHaveBeenCalledTimes(1)

      // Second call within TTL - uses cache
      clock.mockReturnValue(1000) // 1 second later
      const result = await service.getRate()

      expect(result.rate).toBe(BASE_RATE)
      expect(result.isStale).toBeUndefined()
      expect(getRateSpy).toHaveBeenCalledTimes(1) // No additional call
    })

    it('refreshes rate after TTL expires', async () => {
      const provider = new StubConversionProvider(BASE_RATE)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, { clock, cacheTtlMs: CACHE_TTL_MS })
      const getRateSpy = vi.spyOn(provider, 'getRate')

      // First call at t=0
      await service.getRate()
      expect(getRateSpy).toHaveBeenCalledTimes(1)

      // Second call after TTL - should refresh
      clock.mockReturnValue(CACHE_TTL_MS + 1)
      const result = await service.getRate()

      expect(result.rate).toBe(BASE_RATE)
      expect(getRateSpy).toHaveBeenCalledTimes(2) // Refreshed
    })
  })

  describe('hard staleness surfacing', () => {
    it('rejects rate beyond hard staleness limit', async () => {
      const provider = new StubConversionProvider(BASE_RATE)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })

      // First call at t=0
      await service.getRate()

      // Call beyond hard staleness limit
      clock.mockReturnValue(HARD_STALENESS_MS + 1)

      await expect(service.getRate()).rejects.toThrow(ConversionProviderError)
      await expect(service.getRate()).rejects.toThrow(/too stale/)
    })

    it('rejects rate beyond hard staleness even if provider fails', async () => {
      const provider = {
        async getRate() {
          throw new ConversionProviderError('Provider down', 'NETWORK')
        },
        async convertNgnToUsdc() {
          throw new ConversionProviderError('Provider down', 'NETWORK')
        },
      }
      const clock = vi.fn(() => 0)

      // First call at t=0 with working provider
      const workingProvider = new StubConversionProvider(BASE_RATE)
      const serviceWithCache = new ConversionRateService(workingProvider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })
      await serviceWithCache.getRate()

      // Now switch to failing provider and advance time beyond hard limit
      const failingService = new ConversionRateService(provider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })
      // Manually set cache to simulate having old data
      failingService['cache'] = serviceWithCache['cache']

      clock.mockReturnValue(HARD_STALENESS_MS + 1)

      await expect(failingService.getRate()).rejects.toThrow(/too stale/)
    })

    it('allows rate exactly at hard staleness limit', async () => {
      const provider = new StubConversionProvider(BASE_RATE)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })

      // First call at t=0
      await service.getRate()

      // Call exactly at hard staleness limit - should try to refresh
      clock.mockReturnValue(HARD_STALENESS_MS)
      const result = await service.getRate()

      expect(result.rate).toBe(BASE_RATE)
      expect(result.isStale).toBeUndefined() // Refreshed successfully
    })
  })

  describe('provider failure fallback', () => {
    it('falls back to stale cache within hard staleness limit on provider failure', async () => {
      const provider = {
        async getRate() {
          throw new ConversionProviderError('Provider down', 'NETWORK')
        },
        async convertNgnToUsdc() {
          throw new ConversionProviderError('Provider down', 'NETWORK')
        },
      }
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })

      // First call with working provider to populate cache
      const workingProvider = new StubConversionProvider(BASE_RATE)
      const serviceWithCache = new ConversionRateService(workingProvider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })
      await serviceWithCache.getRate()

      // Switch to failing provider but keep cache
      service['cache'] = serviceWithCache['cache']
      clock.mockReturnValue(CACHE_TTL_MS + 60_000) // 6 minutes old

      const result = await service.getRate()

      expect(result.rate).toBe(BASE_RATE)
      expect(result.isStale).toBe(true)
      expect(result.source).toBe('stub')
    })

    it('rejects when provider fails and cache is beyond hard staleness', async () => {
      const provider = {
        async getRate() {
          throw new ConversionProviderError('Provider down', 'NETWORK')
        },
        async convertNgnToUsdc() {
          throw new ConversionProviderError('Provider down', 'NETWORK')
        },
      }
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })

      // First call with working provider to populate cache
      const workingProvider = new StubConversionProvider(BASE_RATE)
      const serviceWithCache = new ConversionRateService(workingProvider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })
      await serviceWithCache.getRate()

      // Switch to failing provider and advance beyond hard limit
      service['cache'] = serviceWithCache['cache']
      clock.mockReturnValue(HARD_STALENESS_MS + 1)

      await expect(service.getRate()).rejects.toThrow(/too stale/)
    })

    it('rejects when provider fails and no cache exists', async () => {
      const provider = {
        async getRate() {
          throw new ConversionProviderError('Provider down', 'NETWORK')
        },
        async convertNgnToUsdc() {
          throw new ConversionProviderError('Provider down', 'NETWORK')
        },
      }
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })

      await expect(service.getRate()).rejects.toThrow('Provider down')
    })

    it('clearly marks fallback rates as stale', async () => {
      const provider = {
        async getRate() {
          throw new ConversionProviderError('Provider down', 'NETWORK')
        },
        async convertNgnToUsdc() {
          throw new ConversionProviderError('Provider down', 'NETWORK')
        },
      }
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })

      // Populate cache
      const workingProvider = new StubConversionProvider(BASE_RATE)
      const serviceWithCache = new ConversionRateService(workingProvider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })
      await serviceWithCache.getRate()

      // Switch to failing provider
      service['cache'] = serviceWithCache['cache']
      clock.mockReturnValue(CACHE_TTL_MS + 60_000)

      const result = await service.getRate()

      expect(result.isStale).toBe(true)
    })
  })

  describe('sanity bounds for implausible rates', () => {
    it('rejects zero rate', async () => {
      const provider = new StubConversionProvider(0)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, { clock })

      await expect(service.getRate()).rejects.toThrow(ConversionProviderError)
      await expect(service.getRate()).rejects.toThrow(/positive/)
    })

    it('rejects negative rate', async () => {
      const provider = new StubConversionProvider(-100)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, { clock })

      await expect(service.getRate()).rejects.toThrow(ConversionProviderError)
      await expect(service.getRate()).rejects.toThrow(/positive/)
    })

    it('rejects infinite rate', async () => {
      const provider = {
        async getRate() {
          return { rate: Infinity, source: 'test' }
        },
        async convertNgnToUsdc() {
          throw new Error('Not implemented')
        },
      }
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, { clock })

      await expect(service.getRate()).rejects.toThrow(ConversionProviderError)
      await expect(service.getRate()).rejects.toThrow(/finite/)
    })

    it('rejects NaN rate', async () => {
      const provider = {
        async getRate() {
          return { rate: Number.NaN, source: 'test' }
        },
        async convertNgnToUsdc() {
          throw new Error('Not implemented')
        },
      }
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, { clock })

      await expect(service.getRate()).rejects.toThrow(ConversionProviderError)
      await expect(service.getRate()).rejects.toThrow(/finite/)
    })

    it('rejects rate below minimum bound', async () => {
      const provider = new StubConversionProvider(50)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        minRate: 100,
        maxRate: 10_000,
      })

      await expect(service.getRate()).rejects.toThrow(ConversionProviderError)
      await expect(service.getRate()).rejects.toThrow(/outside acceptable bounds/)
    })

    it('rejects rate above maximum bound', async () => {
      const provider = new StubConversionProvider(20_000)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        minRate: 100,
        maxRate: 10_000,
      })

      await expect(service.getRate()).rejects.toThrow(ConversionProviderError)
      await expect(service.getRate()).rejects.toThrow(/outside acceptable bounds/)
    })

    it('accepts rate within bounds', async () => {
      const provider = new StubConversionProvider(1600)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        minRate: 100,
        maxRate: 10_000,
      })

      const result = await service.getRate()

      expect(result.rate).toBe(1600)
    })

    it('accepts rate at minimum bound', async () => {
      const provider = new StubConversionProvider(100)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        minRate: 100,
        maxRate: 10_000,
      })

      const result = await service.getRate()

      expect(result.rate).toBe(100)
    })

    it('accepts rate at maximum bound', async () => {
      const provider = new StubConversionProvider(10_000)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        minRate: 100,
        maxRate: 10_000,
      })

      const result = await service.getRate()

      expect(result.rate).toBe(10_000)
    })

    it('uses default bounds when not specified', async () => {
      const provider = new StubConversionProvider(1600)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, { clock })

      const result = await service.getRate()

      expect(result.rate).toBe(1600)
    })
  })

  describe('cache management', () => {
    it('clearCache removes cached rate', async () => {
      const provider = new StubConversionProvider(BASE_RATE)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, { clock, cacheTtlMs: CACHE_TTL_MS })
      const getRateSpy = vi.spyOn(provider, 'getRate')

      await service.getRate()
      expect(getRateSpy).toHaveBeenCalledTimes(1)

      service.clearCache()

      // Should fetch again after clear
      await service.getRate()
      expect(getRateSpy).toHaveBeenCalledTimes(2)
    })

    it('clearCache allows fresh fetch after staleness', async () => {
      const provider = new StubConversionProvider(BASE_RATE)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })

      // First call
      await service.getRate()

      // Advance beyond hard staleness
      clock.mockReturnValue(HARD_STALENESS_MS + 1)

      // Clear cache and fetch fresh
      service.clearCache()
      const result = await service.getRate()

      expect(result.rate).toBe(BASE_RATE)
      expect(result.isStale).toBeUndefined()
    })
  })

  describe('integration scenarios', () => {
    it('handles typical cache lifecycle: fresh -> cached -> refresh', async () => {
      const provider = new StubConversionProvider(BASE_RATE)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(provider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })
      const getRateSpy = vi.spyOn(provider, 'getRate')

      // Fresh rate
      const fresh = await service.getRate()
      expect(fresh.isStale).toBeUndefined()
      expect(getRateSpy).toHaveBeenCalledTimes(1)

      // Within TTL - still fresh
      clock.mockReturnValue(CACHE_TTL_MS - 1000)
      const cached = await service.getRate()
      expect(cached.isStale).toBeUndefined()
      expect(getRateSpy).toHaveBeenCalledTimes(1)

      // After TTL - refreshes
      clock.mockReturnValue(CACHE_TTL_MS + 60_000)
      const refreshed = await service.getRate()
      expect(refreshed.isStale).toBeUndefined()
      expect(getRateSpy).toHaveBeenCalledTimes(2)
    })

    it('handles provider outage with graceful degradation', async () => {
      const workingProvider = new StubConversionProvider(BASE_RATE)
      const clock = vi.fn(() => 0)
      const service = new ConversionRateService(workingProvider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })

      // Populate cache
      await service.getRate()

      // Simulate provider failure
      const failingProvider = {
        async getRate() {
          throw new ConversionProviderError('Provider down', 'NETWORK')
        },
        async convertNgnToUsdc() {
          throw new ConversionProviderError('Provider down', 'NETWORK')
        },
      }
      const failingService = new ConversionRateService(failingProvider, {
        clock,
        cacheTtlMs: CACHE_TTL_MS,
        hardStalenessMs: HARD_STALENESS_MS,
      })
      failingService['cache'] = service['cache']

      // Advance time but within hard limit
      clock.mockReturnValue(CACHE_TTL_MS + 60_000)

      // Should fallback to stale cache
      const result = await failingService.getRate()
      expect(result.rate).toBe(BASE_RATE)
      expect(result.isStale).toBe(true)
    })
  })
})
