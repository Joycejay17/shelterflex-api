import { randomUUID } from 'node:crypto'

export type AdminTaskType = 'late_payment_escalation' | 'landlord_protection'

export type AdminTaskStatus = 'open' | 'in_progress' | 'resolved'

export interface AdminTask {
  id: string
  type: AdminTaskType
  status: AdminTaskStatus
  dealId: string
  tenantId: string
  landlordId: string
  paymentId: string
  period: number
  daysPastDue: number
  summary: string
  createdAt: Date
}

class AdminTaskStore {
  private tasks: AdminTask[] = []

  create(input: Omit<AdminTask, 'id' | 'status' | 'createdAt'>): AdminTask {
    const existing = this.tasks.find(
      (t) =>
        t.type === input.type &&
        t.dealId === input.dealId &&
        t.paymentId === input.paymentId &&
        t.status === 'open',
    )
    if (existing) return existing

    const task: AdminTask = {
      id: randomUUID(),
      status: 'open',
      createdAt: new Date(),
      ...input,
    }
    this.tasks.push(task)
    return task
  }

  listOpen(): AdminTask[] {
    return this.tasks.filter((t) => t.status === 'open')
  }

  findByDealAndPayment(dealId: string, paymentId: string): AdminTask | undefined {
    return this.tasks.find(
      (t) => t.dealId === dealId && t.paymentId === paymentId && t.status === 'open',
    )
  }

  clear(): void {
    this.tasks = []
  }
}

export const adminTaskStore = new AdminTaskStore()
