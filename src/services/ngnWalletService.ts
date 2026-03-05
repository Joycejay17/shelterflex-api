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
