/**
 * Soroban Event Parsers
 * Parses event topics and data into typed event records
 */

export interface IndexedContractEvent {
  contractId: string
  ledgerSequence: number
  transactionHash: string
  eventType: string
  topic1?: string
  topic2?: string
  dataJson: Record<string, unknown>
  indexedAt: Date
}

export interface PaymentRecordedEvent extends IndexedContractEvent {
  eventType: 'PaymentRecorded'
  dealId: string
  period: number
  amount: string
  payer: string
}

export interface DealActivatedEvent extends IndexedContractEvent {
  eventType: 'DealActivated'
  dealId: string
  tenantId: string
  landlordId: string
  financedAmount: string
}

export interface RewardDistributedEvent extends IndexedContractEvent {
  eventType: 'RewardDistributed'
  rewardId: string
  whistleblowerId: string
  amount: string
}

export interface WhistleblowerValidatedEvent extends IndexedContractEvent {
  eventType: 'WhistleblowerValidated'
  whistleblowerId: string
  validationScore: number
}

export interface StakeDepositedEvent extends IndexedContractEvent {
  eventType: 'StakeDeposited'
  stakerId: string
  amount: string
  lockPeriod: number
}

/**
 * Parse PaymentRecorded event
 */
export function parsePaymentRecorded(event: any): PaymentRecordedEvent | null {
  try {
    if (!event.topics || event.topics.length < 1) return null
    
    return {
      contractId: event.contractId,
      ledgerSequence: event.ledgerSequence,
      transactionHash: event.transactionHash,
      eventType: 'PaymentRecorded',
      topic1: event.topics[0],
      dataJson: event.data || {},
      indexedAt: new Date(),
      dealId: event.data.dealId || '',
      period: parseInt(event.data.period || '0'),
      amount: event.data.amount || '0',
      payer: event.data.payer || '',
    }
  } catch (error) {
    return null
  }
}

/**
 * Parse DealActivated event
 */
export function parseDealActivated(event: any): DealActivatedEvent | null {
  try {
    if (!event.topics || event.topics.length < 1) return null
    
    return {
      contractId: event.contractId,
      ledgerSequence: event.ledgerSequence,
      transactionHash: event.transactionHash,
      eventType: 'DealActivated',
      topic1: event.topics[0],
      dataJson: event.data || {},
      indexedAt: new Date(),
      dealId: event.data.dealId || '',
      tenantId: event.data.tenantId || '',
      landlordId: event.data.landlordId || '',
      financedAmount: event.data.financedAmount || '0',
    }
  } catch (error) {
    return null
  }
}

/**
 * Parse RewardDistributed event
 */
export function parseRewardDistributed(event: any): RewardDistributedEvent | null {
  try {
    if (!event.topics || event.topics.length < 1) return null
    
    return {
      contractId: event.contractId,
      ledgerSequence: event.ledgerSequence,
      transactionHash: event.transactionHash,
      eventType: 'RewardDistributed',
      topic1: event.topics[0],
      dataJson: event.data || {},
      indexedAt: new Date(),
      rewardId: event.data.rewardId || '',
      whistleblowerId: event.data.whistleblowerId || '',
      amount: event.data.amount || '0',
    }
  } catch (error) {
    return null
  }
}

/**
 * Parse WhistleblowerValidated event
 */
export function parseWhistleblowerValidated(event: any): WhistleblowerValidatedEvent | null {
  try {
    if (!event.topics || event.topics.length < 1) return null
    
    return {
      contractId: event.contractId,
      ledgerSequence: event.ledgerSequence,
      transactionHash: event.transactionHash,
      eventType: 'WhistleblowerValidated',
      topic1: event.topics[0],
      dataJson: event.data || {},
      indexedAt: new Date(),
      whistleblowerId: event.data.whistleblowerId || '',
      validationScore: parseInt(event.data.validationScore || '0'),
    }
  } catch (error) {
    return null
  }
}

/**
 * Parse StakeDeposited event
 */
export function parseStakeDeposited(event: any): StakeDepositedEvent | null {
  try {
    if (!event.topics || event.topics.length < 1) return null
    
    return {
      contractId: event.contractId,
      ledgerSequence: event.ledgerSequence,
      transactionHash: event.transactionHash,
      eventType: 'StakeDeposited',
      topic1: event.topics[0],
      dataJson: event.data || {},
      indexedAt: new Date(),
      stakerId: event.data.stakerId || '',
      amount: event.data.amount || '0',
      lockPeriod: parseInt(event.data.lockPeriod || '0'),
    }
  } catch (error) {
    return null
  }
}

/**
 * Parse event based on event type
 */
export function parseEvent(event: any): IndexedContractEvent | null {
  const eventType = event.topics?.[0] || event.eventType
  
  switch (eventType) {
    case 'PaymentRecorded':
      return parsePaymentRecorded(event)
    case 'DealActivated':
      return parseDealActivated(event)
    case 'RewardDistributed':
      return parseRewardDistributed(event)
    case 'WhistleblowerValidated':
      return parseWhistleblowerValidated(event)
    case 'StakeDeposited':
      return parseStakeDeposited(event)
    default:
      // Return generic event if type not recognized
      return {
        contractId: event.contractId,
        ledgerSequence: event.ledgerSequence,
        transactionHash: event.transactionHash,
        eventType: eventType || 'Unknown',
        topic1: event.topics?.[0],
        topic2: event.topics?.[1],
        dataJson: event.data || {},
        indexedAt: new Date(),
      }
  }
}
