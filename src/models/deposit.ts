export type DepositStatus = 'confirmed' | 'consumed'

export type DepositProvider = 'onramp' | 'offramp' | 'manual_admin'

export interface DepositRecord {
  depositId: string
  userId: string
  amountNgn: number
  provider: DepositProvider
  providerRef: string
  status: DepositStatus
  createdAt: Date
  updatedAt: Date
  consumedAt: Date | null
}

export interface ConfirmDepositInput {
  depositId: string
  userId: string
  amountNgn: number
  provider: DepositProvider
  providerRef: string
}
