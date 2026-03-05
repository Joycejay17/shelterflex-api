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
  }
}

export const depositStore = new DepositStore()
