import type { SorobanAdapter } from './adapter.js'

export interface PriceFeed {
  pair: string
  price: string
  decimals: number
  updatedAt: number
  sequence: number
}

export interface OracleClient {
  updatePrice(pair: string, price: bigint, sequence: bigint): Promise<string>
  getPrice(pair: string): Promise<PriceFeed>
  getPriceUnsafe(pair: string): Promise<PriceFeed>
  isStale(pair: string): Promise<boolean>
}

/**
 * Typed wrapper for the oracle_price_feeds Soroban contract.
 * Invokes contract methods via SorobanAdapter simulation/submit hooks.
 */
export class OracleSorobanClient implements OracleClient {
  constructor(
    private readonly adapter: SorobanAdapter,
    private readonly contractId: string,
  ) {}

  async updatePrice(pair: string, price: bigint, sequence: bigint): Promise<string> {
    return this.invoke('update_price', [pair, price.toString(), sequence.toString()])
  }

  async getPrice(pair: string): Promise<PriceFeed> {
    const raw = await this.simulate('get_price', [pair])
    return this.parseFeed(raw)
  }

  async getPriceUnsafe(pair: string): Promise<PriceFeed> {
    const raw = await this.simulate('get_price_unsafe', [pair])
    return this.parseFeed(raw)
  }

  async isStale(pair: string): Promise<boolean> {
    const raw = await this.simulate('is_stale', [pair])
    return Boolean(raw)
  }

  private async invoke(fn: string, args: string[]): Promise<string> {
    const invoke = (this.adapter as { invokeContract?: (...a: unknown[]) => Promise<string> })
      .invokeContract
    if (typeof invoke !== 'function') {
      throw new Error('SorobanAdapter does not support contract invocation')
    }
    return invoke(this.contractId, fn, args)
  }

  private async simulate(fn: string, args: string[]): Promise<unknown> {
    const simulate = (this.adapter as { simulateContract?: (...a: unknown[]) => Promise<unknown> })
      .simulateContract
    if (typeof simulate !== 'function') {
      throw new Error('SorobanAdapter does not support contract simulation')
    }
    return simulate(this.contractId, fn, args)
  }

  private parseFeed(raw: unknown): PriceFeed {
    const rec = raw as Record<string, unknown>
    return {
      pair: String(rec.pair ?? ''),
      price: String(rec.price ?? '0'),
      decimals: Number(rec.decimals ?? 7),
      updatedAt: Number(rec.updated_at ?? rec.updatedAt ?? 0),
      sequence: Number(rec.sequence ?? 0),
    }
  }
}
