import { SorobanAdapter } from '../soroban/adapter.js'
import { logger } from '../utils/logger.js'
import { outboxStore } from './store.js'
import { OutboxStatus, TxType, type OutboxItem } from './types.js'

/**
 * Outbox sender - handles sending transactions to the blockchain
 */
export class OutboxSender {
  constructor(private adapter: SorobanAdapter) {}

  /**
   * Attempt to send an outbox item to the blockchain
   * Returns true if successful, false otherwise
   */
  async send(item: OutboxItem): Promise<boolean> {
    try {
      logger.info('Attempting to send outbox item', {
        id: item.id,
        txType: item.txType,
        txId: item.txId,
        attempt: item.attempts + 1,
      })

      // Route to appropriate handler based on tx type
      switch (item.txType) {
        case TxType.RECEIPT:
          await this.sendReceipt(item)
          break
        default:
          throw new Error(`Unknown tx type: ${item.txType}`)
      }

      // Mark as sent
      await outboxStore.updateStatus(item.id, OutboxStatus.SENT)

      logger.info('Successfully sent outbox item', {
        id: item.id,
        txId: item.txId,
      })

      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      logger.error('Failed to send outbox item', {
        id: item.id,
        txId: item.txId,
        attempt: item.attempts + 1,
        error: errorMessage,
      })

      // Mark as failed
      await outboxStore.updateStatus(item.id, OutboxStatus.FAILED, errorMessage)

      return false
    }
  }

  /**
   * Send a receipt transaction
   * 
   * Note: In production, this would call the actual Soroban contract method
   * to create a receipt. For now, we simulate with a credit operation.
   */
  private async sendReceipt(item: OutboxItem): Promise<void> {
    const { payload } = item

    // Validate payload structure
    if (!payload.dealId || !payload.amount || !payload.payer) {
      throw new Error('Invalid receipt payload: missing required fields')
    }

    const dealId = String(payload.dealId)
    const amount = BigInt(String(payload.amount))
    const payer = String(payload.payer)

    // TODO: Replace with actual contract call to create_receipt
    // For MVP, we simulate by crediting the payer's account
    // In production: client.create_receipt(dealId, amount, payer, txId)
    
    logger.debug('Simulating receipt creation', {
      dealId,
      amount: amount.toString(),
      payer,
      txId: item.txId,
    })

    // Simulate network call with potential failure
    if (Math.random() < 0.1) {
      // 10% simulated failure rate for testing
      throw new Error('Simulated network failure')
    }

    // For now, just log the operation
    // await this.adapter.credit(payer, amount)
  }

  /**
   * Retry a failed outbox item
   */
  async retry(itemId: string): Promise<boolean> {
    const item = await outboxStore.getById(itemId)
    if (!item) {
      throw new Error(`Outbox item not found: ${itemId}`)
    }

    if (item.status === OutboxStatus.SENT) {
      logger.info('Outbox item already sent, skipping retry', { id: itemId })
      return true
    }

    return this.send(item)
  }

  /**
   * Retry all failed items
   */
  async retryAll(): Promise<{ succeeded: number; failed: number }> {
    const failedItems = await outboxStore.listByStatus(OutboxStatus.FAILED)
    
    let succeeded = 0
    let failed = 0

    for (const item of failedItems) {
      const success = await this.send(item)
      if (success) {
        succeeded++
      } else {
        failed++
      }
    }

    return { succeeded, failed }
  }
}
