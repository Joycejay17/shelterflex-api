export enum DepositStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

export interface CustomerMeta {
  name?: string
  phone?: string
}

export interface Deposit {
  depositId: string
  quoteId: string
  userId: string
  paymentRail: string
  amountNgn: number
  status: DepositStatus
  externalRefSource?: string
  externalRef?: string
  confirmedAt?: Date
  customerMeta?: CustomerMeta
  createdAt: Date
  updatedAt: Date
}

export interface CreateDepositInput {
  quoteId: string
  userId: string
  paymentRail: string
  amountNgn: number
  customerMeta?: CustomerMeta
}

export interface ConfirmDepositInput {
  rail: string
  externalRefSource: string
  externalRef: string
}
