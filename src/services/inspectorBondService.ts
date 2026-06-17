import { SorobanAdapter } from '../soroban/adapter.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'

export interface BondStatus {
  isBonded: boolean
  amount: string
}

export class InspectorBondService {
  constructor(private adapter: SorobanAdapter) {}

  async stake(inspectorId: string, amount: bigint): Promise<void> {
    if (amount <= 0n) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Bond amount must be greater than zero')
    }
    logger.info('Inspector staking bond', { inspectorId, amount: amount.toString() })
    await this.adapter.stakeBond(inspectorId, amount)
  }

  async unstake(inspectorId: string): Promise<void> {
    const bonded = await this.adapter.isBonded(inspectorId)
    if (!bonded) {
      throw new AppError(ErrorCode.INSPECTOR_NOT_BONDED, 400, 'No active bond to unstake')
    }
    logger.info('Inspector unstaking bond', { inspectorId })
    await this.adapter.unstakeBond(inspectorId)
  }

  async getStatus(inspectorId: string): Promise<BondStatus> {
    const { isBonded, amount } = await this.adapter.getBond(inspectorId)
    return { isBonded, amount: amount.toString() }
  }

  async assertBonded(inspectorId: string): Promise<void> {
    const bonded = await this.adapter.isBonded(inspectorId)
    if (!bonded) {
      throw new AppError(
        ErrorCode.INSPECTOR_NOT_BONDED,
        403,
        'Inspector must post a bond before claiming jobs',
      )
    }
  }
}
