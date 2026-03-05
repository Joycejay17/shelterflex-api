import { randomUUID } from 'node:crypto'
import { Deposit, DepositStatus, CreateDepositInput } from './deposit.js'

class DepositStore {
  private byId = new Map<string, Deposit>()
  private byCanonicalRef = new Map<string, string>()

  async create(input: CreateDepositInput): Promise<Deposit> {
    const now = new Date()
    const deposit: Deposit = {
      depositId: randomUUID(),
      quoteId: input.quoteId,
      userId: input.userId,
      paymentRail: input.paymentRail,
      amountNgn: input.amountNgn,
      status: DepositStatus.PENDING,
      customerMeta: input.customerMeta,
      createdAt: now,
      updatedAt: now,
    }
    this.byId.set(deposit.depositId, deposit)
    return deposit
  }

  async attachExternalRef(
    depositId: string,
    externalRefSource: string,
    externalRef: string,
  ): Promise<Deposit | null> {
    const deposit = this.byId.get(depositId)
    if (!deposit) return null
    deposit.externalRefSource = externalRefSource
    deposit.externalRef = externalRef
    deposit.updatedAt = new Date()
    const canonical = `${externalRefSource}:${externalRef}`
    this.byCanonicalRef.set(canonical, depositId)
    this.byId.set(depositId, deposit)
    return deposit
  }

  async getById(depositId: string): Promise<Deposit | null> {
    return this.byId.get(depositId) ?? null
  }

  async getByCanonical(rail: string, externalRef: string): Promise<Deposit | null> {
    const id = this.byCanonicalRef.get(`${rail}:${externalRef}`)
    if (!id) return null
    return this.byId.get(id) ?? null
  }

  async confirmByCanonical(rail: string, externalRef: string): Promise<Deposit | null> {
    const deposit = await this.getByCanonical(rail, externalRef)
    if (!deposit) return null
    if (deposit.status === DepositStatus.CONFIRMED) return deposit
    deposit.status = DepositStatus.CONFIRMED
    deposit.confirmedAt = new Date()
    deposit.updatedAt = new Date()
    this.byId.set(deposit.depositId, deposit)
    return deposit
  }

  async fail(depositId: string): Promise<Deposit | null> {
    const deposit = this.byId.get(depositId)
    if (!deposit) return null
    deposit.status = DepositStatus.FAILED
    deposit.updatedAt = new Date()
    this.byId.set(depositId, deposit)
    return deposit
  }

  async clear(): Promise<void> {
    this.byId.clear()
    this.byCanonicalRef.clear()
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
