import { 
  WithdrawalRequest, 
  WithdrawalResponse, 
  WithdrawalHistoryResponse,
  NgnBalanceResponse,
  NgnLedgerResponse,
  NgnLedgerEntry
} from '../schemas/ngnWallet.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import { depositStore } from '../models/depositStore.js'

export class NgnWalletService {
  // In-memory storage for demo purposes
  // In production, this would be replaced with a proper database
  private withdrawals: WithdrawalResponse[] = []
  private ledger: NgnLedgerEntry[] = []
  private balances: Map<string, NgnBalanceResponse> = new Map()

  constructor() {
    // Initialize with some demo data
    this.initializeDemoData()
  }

  private initializeDemoData() {
    // Set up demo user balances
    this.balances.set('63468761-0500-4dd9-9d75-c30cbc8d42da', {
      availableNgn: 50000,
      heldNgn: 5000,
      totalNgn: 55000
    })

    // Add some demo ledger entries
    this.ledger = [
      {
        id: '1',
        type: 'top_up',
        amountNgn: 10000,
        status: 'confirmed',
        timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        reference: 'TOPUP-001'
      },
      {
        id: '2', 
        type: 'withdrawal',
        amountNgn: -5000,
        status: 'confirmed',
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        reference: 'WD-001'
      },
      {
        id: '3',
        type: 'withdrawal',
        amountNgn: -2000,
        status: 'pending',
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        reference: 'WD-002'
      }
    ]

    // Add some demo withdrawals
    this.withdrawals = [
      {
        id: 'wd-1',
        amountNgn: 5000,
        status: 'confirmed',
        bankAccount: {
          accountNumber: '1234567890',
          accountName: 'John Doe',
          bankName: 'Guaranty Trust Bank'
        },
        reference: 'WD-001',
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        processedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        failureReason: null
      },
      {
        id: 'wd-2',
        amountNgn: 2000,
        status: 'pending',
        bankAccount: {
          accountNumber: '0987654321',
          accountName: 'John Doe',
          bankName: 'First Bank of Nigeria'
        },
        reference: 'WD-002',
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        processedAt: null,
        failureReason: null
      }
    ]
  }

  async getBalance(userId: string): Promise<NgnBalanceResponse> {
    logger.info('Getting NGN balance', { userId })
    
    let balance = this.balances.get(userId)
    if (!balance) {
      balance = {
        availableNgn: 50000,
        heldNgn: 5000,
        totalNgn: 55000,
      }
      this.balances.set(userId, balance)
    }

    return balance
  }

  /**
   * Check if user is frozen (either by negative balance or manual freeze)
   */
  async isUserFrozen(userId: string): Promise<boolean> {
    const riskState = await userRiskStateStore.getByUserId(userId)
    if (riskState?.isFrozen) {
      return true
    }

    const balance = await this.getBalance(userId)
    return balance.totalNgn < 0
  }

  /**
   * Ensure user is not frozen before allowing risky operations
   */
  async requireNotFrozen(userId: string): Promise<void> {
    const frozen = await this.isUserFrozen(userId)
    if (frozen) {
      const balance = await this.getBalance(userId)
      const riskState = await userRiskStateStore.getByUserId(userId)
      
      let message = 'Account frozen. '
      if (balance.totalNgn < 0) {
        message += `Negative balance: ${balance.totalNgn} NGN. Please top up to continue.`
      } else if (riskState?.freezeReason === 'MANUAL') {
        message += 'Manual freeze by admin. Contact support.'
      } else if (riskState?.freezeReason === 'COMPLIANCE') {
        message += 'Compliance review required. Contact support.'
      }

      throw new AppError(ErrorCode.ACCOUNT_FROZEN, 403, message)
    }
  }

  /**
   * Process a deposit reversal/chargeback
   * This is idempotent based on (provider, providerRef, eventType)
   */
  async processDepositReversal(
    provider: string,
    providerRef: string,
    reversalRef: string
  ): Promise<void> {
    logger.info('Processing deposit reversal', { provider, providerRef, reversalRef })

    // Find the original deposit
    const deposit = await depositStore.getByProviderRef(provider, providerRef)
    if (!deposit) {
      logger.warn('Deposit not found for reversal', { provider, providerRef })
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Original deposit not found')
    }

    // Idempotent check - if already reversed, skip
    if (deposit.reversedAt) {
      logger.info('Deposit already reversed, skipping', { 
        depositId: deposit.depositId, 
        reversedAt: deposit.reversedAt 
      })
      return
    }

    // Mark deposit as reversed
    await depositStore.markReversed(deposit.depositId, reversalRef)

    // Write reversal ledger entry (negative amount)
    const reversalEntry: NgnLedgerEntry = {
      id: `reversal-${deposit.depositId}`,
      type: 'top_up_reversed',
      amountNgn: -deposit.amountNgn,
      status: 'confirmed',
      timestamp: new Date().toISOString(),
      reference: reversalRef,
    }
    this.ledger.unshift(reversalEntry)

    // Update user balance
    const balance = await this.getBalance(deposit.userId)
    const newTotalNgn = balance.totalNgn - deposit.amountNgn
    const newAvailableNgn = balance.availableNgn - deposit.amountNgn

    this.balances.set(deposit.userId, {
      availableNgn: newAvailableNgn,
      heldNgn: balance.heldNgn,
      totalNgn: newTotalNgn,
    })

    logger.info('Balance updated after reversal', {
      userId: deposit.userId,
      oldTotal: balance.totalNgn,
      newTotal: newTotalNgn,
      reversalAmount: deposit.amountNgn,
    })

    // Auto-freeze if balance is now negative
    if (newTotalNgn < 0) {
      await userRiskStateStore.freeze(
        deposit.userId,
        'NEGATIVE_BALANCE',
        `Auto-frozen due to deposit reversal. Deficit: ${Math.abs(newTotalNgn)} NGN`
      )
      logger.warn('User frozen due to negative balance after reversal', {
        userId: deposit.userId,
        totalNgn: newTotalNgn,
      })
    }
  }

  /**
   * Process a top-up and auto-unfreeze if balance becomes positive
   */
  async processTopUp(userId: string, amountNgn: number, reference: string): Promise<void> {
    logger.info('Processing top-up', { userId, amountNgn, reference })

    const balance = await this.getBalance(userId)
    const newTotalNgn = balance.totalNgn + amountNgn
    const newAvailableNgn = balance.availableNgn + amountNgn

    this.balances.set(userId, {
      availableNgn: newAvailableNgn,
      heldNgn: balance.heldNgn,
      totalNgn: newTotalNgn,
    })

    // Add ledger entry
    const topUpEntry: NgnLedgerEntry = {
      id: `topup-${Date.now()}`,
      type: 'top_up',
      amountNgn,
      status: 'confirmed',
      timestamp: new Date().toISOString(),
      reference,
    }
    this.ledger.unshift(topUpEntry)

    logger.info('Balance updated after top-up', {
      userId,
      oldTotal: balance.totalNgn,
      newTotal: newTotalNgn,
      topUpAmount: amountNgn,
    })

    // Auto-unfreeze if balance is now non-negative and freeze reason is NEGATIVE_BALANCE
    const riskState = await userRiskStateStore.getByUserId(userId)
    if (riskState?.isFrozen && riskState.freezeReason === 'NEGATIVE_BALANCE' && newTotalNgn >= 0) {
      await userRiskStateStore.unfreeze(
        userId,
        `Auto-unfrozen after top-up. Balance restored to ${newTotalNgn} NGN`
      )
      logger.info('User auto-unfrozen after balance restored', {
        userId,
        totalNgn: newTotalNgn,
      })
    }
  }

  async getLedger(userId: string, options: { limit?: number; cursor?: string } = {}): Promise<NgnLedgerResponse> {
    logger.info('Getting NGN ledger', { userId, options })
    
    let entries = [...this.ledger].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    const limit = options.limit || 20
    entries = entries.slice(0, limit)

    return {
      entries,
      nextCursor: null
    }
  }

  async initiateWithdrawal(userId: string, request: WithdrawalRequest): Promise<WithdrawalResponse> {
    logger.info('Initiating withdrawal', { userId, amount: request.amountNgn })

    // Check if user is frozen
    await this.requireNotFrozen(userId)

    // Check user balance
    const balance = await this.getBalance(userId)
    if (request.amountNgn > balance.availableNgn) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR, 
        400, 
        `Insufficient balance. Available: ${balance.availableNgn}, Requested: ${request.amountNgn}`
      )
    }

    // Create withdrawal record
    const withdrawal: WithdrawalResponse = {
      id: `wd-${Date.now()}`,
      amountNgn: request.amountNgn,
      status: 'pending',
      bankAccount: request.bankAccount,
      reference: `WD-${Date.now()}`,
      createdAt: new Date().toISOString(),
      processedAt: null,
      failureReason: null
    }

    // Update held funds
    const updatedBalance: NgnBalanceResponse = {
      availableNgn: balance.availableNgn - request.amountNgn,
      heldNgn: balance.heldNgn + request.amountNgn,
      totalNgn: balance.totalNgn
    }
    this.balances.set(userId, updatedBalance)

    // Add to withdrawals
    this.withdrawals.unshift(withdrawal)

    // Add to ledger
    const ledgerEntry: NgnLedgerEntry = {
      id: withdrawal.id,
      type: 'withdrawal',
      amountNgn: -request.amountNgn,
      status: 'pending',
      timestamp: withdrawal.createdAt,
      reference: withdrawal.reference
    }
    this.ledger.unshift(ledgerEntry)

    logger.info('Withdrawal initiated successfully', { 
      userId, 
      withdrawalId: withdrawal.id,
      amount: request.amountNgn 
    })

    return withdrawal
  }

  async getWithdrawalHistory(userId: string, options: { limit?: number; cursor?: string } = {}): Promise<WithdrawalHistoryResponse> {
    logger.info('Getting withdrawal history', { userId, options })

    let entries = [...this.withdrawals].sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )

    const limit = options.limit || 20
    entries = entries.slice(0, limit)

    return {
      entries,
      nextCursor: null
    }
  }

  // Helper method for testing/demo - simulate withdrawal processing
  async processWithdrawal(withdrawalId: string, status: 'approved' | 'rejected' | 'confirmed' | 'failed', failureReason?: string): Promise<void> {
    const withdrawal = this.withdrawals.find(w => w.id === withdrawalId)
    if (!withdrawal) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Withdrawal not found')
    }

    withdrawal.status = status
    withdrawal.processedAt = new Date().toISOString()
    withdrawal.failureReason = failureReason || null

    // Update ledger entry
    const ledgerEntry = this.ledger.find(e => e.id === withdrawalId)
    if (ledgerEntry) {
      ledgerEntry.status = status
    }

    // If withdrawal is confirmed or failed, update held funds
    if (status === 'confirmed' || status === 'failed') {
      const balance = this.balances.get('demo-user')
      if (balance) {
        const updatedBalance: NgnBalanceResponse = {
          availableNgn: balance.availableNgn,
          heldNgn: Math.max(0, balance.heldNgn - withdrawal.amountNgn),
          totalNgn: status === 'confirmed' ? balance.totalNgn - withdrawal.amountNgn : balance.totalNgn
        }
        this.balances.set('demo-user', updatedBalance)
      }
    }

    logger.info('Withdrawal processed', { withdrawalId, status, failureReason })
  }
}
