import { ConfirmDepositInput, type DepositRecord } from './deposit.js'

/**
 * In-memory store for confirmed deposits.
 * Keyed by depositId (idempotent confirmation).
 */
class DepositStore {
  private deposits = new Map<string, DepositRecord>()

  async confirm(input: ConfirmDepositInput): Promise<DepositRecord> {
    const existing = this.deposits.get(input.depositId)
    if (existing) {
      return existing
    }

    const now = new Date()
    const record: DepositRecord = {
      depositId: input.depositId,
      userId: input.userId,
      amountNgn: input.amountNgn,
      provider: input.provider,
      providerRef: input.providerRef,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
      consumedAt: null,
    }

    this.deposits.set(input.depositId, record)
    return record
  }

  async getById(depositId: string): Promise<DepositRecord | null> {
    return this.deposits.get(depositId) ?? null
  }

  async markConsumed(depositId: string): Promise<DepositRecord | null> {
    const dep = this.deposits.get(depositId)
    if (!dep) return null

    if (dep.status === 'consumed') {
      return dep
    }

    const now = new Date()
    const updated: DepositRecord = {
      ...dep,
      status: 'consumed',
      consumedAt: now,
      updatedAt: now,
    }

    this.deposits.set(depositId, updated)
    return updated
  }

  async clear(): Promise<void> {
    this.deposits.clear()
  }
}

export const depositStore = new DepositStore()
