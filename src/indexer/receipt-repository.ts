import { TxType } from '../outbox/types.js'

export interface IndexedReceipt {
     txId: string; txType: TxType; dealId: string; listingId?: string
     amountUsdc: string; amountNgn?: number; fxRate?: number; fxProvider?: string
     from?: string; to?: string; externalRefHash: string; metadataHash?: string
     ledger: number; indexedAt: Date
}
export interface ReceiptQuery { dealId?: string; txType?: TxType; page?: number; pageSize?: number }
export interface PagedReceipts { data: IndexedReceipt[]; total: number; page: number; pageSize: number }

export interface ReceiptRepository {
     upsertMany(receipts: IndexedReceipt[]): Promise<void>
     findByDealId(dealId: string): Promise<IndexedReceipt[]>
     query(params: ReceiptQuery): Promise<PagedReceipts>
     getCheckpoint(): Promise<number | null>
     saveCheckpoint(ledger: number): Promise<void>
}

export class StubReceiptRepository implements ReceiptRepository {
     private store = new Map<string, IndexedReceipt>()
     private checkpoint: number | null = null

     async upsertMany(receipts: IndexedReceipt[]) { for (const r of receipts) this.store.set(r.txId, r) }
     async findByDealId(dealId: string) { return [...this.store.values()].filter(r => r.dealId === dealId) }
     async query({ dealId, txType, page = 1, pageSize = 20 }: ReceiptQuery): Promise<PagedReceipts> {
          let r = [...this.store.values()]
          if (dealId) r = r.filter(x => x.dealId === dealId)
          if (txType) r = r.filter(x => x.txType === txType)
          return { data: r.slice((page - 1) * pageSize, page * pageSize), total: r.length, page, pageSize }
     }
     async getCheckpoint() { return this.checkpoint }
     async saveCheckpoint(ledger: number) { this.checkpoint = ledger }
}