import {
    NgnWallet,
    LedgerEntry,
    NgnWalletStore,
} from './ngnWallet.js'
import { getPool } from '../db.js'
import crypto from 'crypto'

export class InMemoryNgnWalletStore implements NgnWalletStore {
    private wallets: Map<string, NgnWallet> = new Map()
    private ledger: LedgerEntry[] = []
    private locks: Map<string, Promise<void>> = new Map()

    async createWallet(userId: string): Promise<NgnWallet> {
        const existing = await this.getWalletByUserId(userId)
        if (existing) return existing

        const wallet: NgnWallet = {
            walletId: crypto.randomUUID(),
            userId,
            currency: 'NGN',
            createdAt: new Date(),
        }
        this.wallets.set(wallet.walletId, wallet)
        return wallet
    }

    async getWalletByUserId(userId: string): Promise<NgnWallet | null> {
        return Array.from(this.wallets.values()).find(w => w.userId === userId) || null
    }

    async getWalletById(walletId: string): Promise<NgnWallet | null> {
        return this.wallets.get(walletId) || null
    }

    async createLedgerEntry(entry: Omit<LedgerEntry, 'entryId' | 'createdAt'>): Promise<LedgerEntry> {
        const newEntry: LedgerEntry = {
            ...entry,
            entryId: crypto.randomUUID(),
            createdAt: new Date(),
        }
        this.ledger.push(newEntry)
        return newEntry
    }

    async getLedgerEntriesByWalletId(walletId: string): Promise<LedgerEntry[]> {
        return this.ledger
            .filter(e => e.walletId === walletId)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    }

    async acquireLock(walletId: string): Promise<() => Promise<void>> {
        const existingLock = this.locks.get(walletId) || Promise.resolve()
        let release: () => void = () => { }
        const newLock = new Promise<void>((resolve) => {
            release = resolve
        })
        this.locks.set(walletId, existingLock.then(() => newLock))
        await existingLock
        return async () => {
            release()
        }
    }

    async clear(): Promise<void> {
        this.wallets.clear()
        this.ledger = []
        this.locks.clear()
    }
}

export class PostgresNgnWalletStore implements NgnWalletStore {
    async createWallet(userId: string): Promise<NgnWallet> {
        const pool = await getPool()
        if (!pool) throw new Error('Database pool not available')
        const { rows } = await pool.query(
            `INSERT INTO ngn_wallets (user_id) 
       VALUES ($1) 
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id 
       RETURNING *`,
            [userId]
        )
        return this.mapWallet(rows[0])
    }

    async getWalletByUserId(userId: string): Promise<NgnWallet | null> {
        const pool = await getPool()
        if (!pool) return null
        const { rows } = await pool.query(
            `SELECT * FROM ngn_wallets WHERE user_id = $1`,
            [userId]
        )
        return rows[0] ? this.mapWallet(rows[0]) : null
    }

    async getWalletById(walletId: string): Promise<NgnWallet | null> {
        const pool = await getPool()
        if (!pool) return null
        const { rows } = await pool.query(
            `SELECT * FROM ngn_wallets WHERE wallet_id = $1`,
            [walletId]
        )
        return rows[0] ? this.mapWallet(rows[0]) : null
    }

    async createLedgerEntry(entry: Omit<LedgerEntry, 'entryId' | 'createdAt'>): Promise<LedgerEntry> {
        const pool = await getPool()
        if (!pool) throw new Error('Database pool not available')
        const { rows } = await pool.query(
            `INSERT INTO ngn_ledger_entries (wallet_id, type, amount_ngn, reference_type, reference_id) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
            [entry.walletId, entry.type, entry.amountNgn, entry.referenceType, entry.referenceId]
        )
        return this.mapLedgerEntry(rows[0])
    }

    async getLedgerEntriesByWalletId(walletId: string): Promise<LedgerEntry[]> {
        const pool = await getPool()
        if (!pool) return []
        const { rows } = await pool.query(
            `SELECT * FROM ngn_ledger_entries WHERE wallet_id = $1 ORDER BY created_at ASC`,
            [walletId]
        )
        return rows.map(this.mapLedgerEntry)
    }

    async acquireLock(walletId: string): Promise<() => Promise<void>> {
        const pool = await getPool()
        if (!pool) throw new Error('Database pool not available')
        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            // Row level lock
            await client.query('SELECT 1 FROM ngn_wallets WHERE wallet_id = $1 FOR UPDATE', [walletId])
            return async () => {
                await client.query('COMMIT')
                client.release()
            }
        } catch (e) {
            await client.query('ROLLBACK')
            client.release()
            throw e
        }
    }

    async clear(): Promise<void> {
        const pool = await getPool()
        if (!pool) return
        await pool.query('DELETE FROM ngn_ledger_entries')
        await pool.query('DELETE FROM ngn_wallets')
    }

    private mapWallet(row: any): NgnWallet {
        return {
            walletId: row.wallet_id,
            userId: row.user_id,
            currency: row.currency,
            createdAt: new Date(row.created_at)
        }
    }

    private mapLedgerEntry(row: any): LedgerEntry {
        return {
            entryId: row.entry_id,
            walletId: row.wallet_id,
            type: row.type,
            amountNgn: Number(row.amount_ngn),
            referenceType: row.reference_type,
            referenceId: row.reference_id,
            createdAt: new Date(row.created_at)
        }
    }
}

// Export singleton instance for app use, default to InMemory for MVP
export const ngnWalletStore: NgnWalletStore = new InMemoryNgnWalletStore()
