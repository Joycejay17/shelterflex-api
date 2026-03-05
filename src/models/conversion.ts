export type ConversionStatus = 'pending' | 'completed' | 'failed'

export type ConversionProviderName = 'onramp' | 'offramp' | 'manual_admin'

export interface ConversionRecord {
  conversionId: string
  depositId: string
  userId: string
  amountNgn: number
  amountUsdc: string
  fxRateNgnPerUsdc: number
  provider: ConversionProviderName
  providerRef: string
  status: ConversionStatus
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
  failedAt: Date | null
  failureReason: string | null
}

export interface CreateConversionInput {
  depositId: string
  userId: string
  amountNgn: number
  provider: ConversionProviderName
}
