import { randomUUID } from 'node:crypto'
import { getPool, type PgPoolLike } from '../db.js'

export type CreditScoreBand = 'poor' | 'fair' | 'good' | 'excellent'
export type CreditScoreFactorStatus = 'pass' | 'fail' | 'warn'

export interface CreditScoreFactor {
  name: string
  status: CreditScoreFactorStatus
  weight: number
  detail: string
}

export interface CreditScoreSnapshot {
  id: string
  userId: string
  score: number
  band: CreditScoreBand
  factors: CreditScoreFactor[]
  computedAt: Date
}

export interface CreateCreditScoreSnapshotInput {
  userId: string
  score: number
  band: CreditScoreBand
  factors: CreditScoreFactor[]
  computedAt?: Date
}

export function bandFromScore(score: number): CreditScoreBand {
  if (score <= 39) return 'poor'
  if (score <= 59) return 'fair'
  if (score <= 79) return 'good'
  return 'excellent'
}

type CreditScoreSnapshotRow = {
  id: string
  user_id: string
  score: number
  band: CreditScoreBand
  factors: unknown
  computed_at: Date
}

interface CreditScoreSnapshotStorePort {
  create(input: CreateCreditScoreSnapshotInput): Promise<CreditScoreSnapshot>
  getLatestByUserId(userId: string): Promise<CreditScoreSnapshot | null>
  getHistoryByUserId(userId: string, limit: number): Promise<CreditScoreSnapshot[]>
  clear(): Promise<void>
}

class InMemoryCreditScoreSnapshotStore implements CreditScoreSnapshotStorePort {
  private snapshots: CreditScoreSnapshot[] = []

  async create(input: CreateCreditScoreSnapshotInput): Promise<CreditScoreSnapshot> {
    const snapshot: CreditScoreSnapshot = {
      id: randomUUID(),
      userId: input.userId,
      score: input.score,
      band: input.band,
      factors: input.factors,
      computedAt: input.computedAt ?? new Date(),
    }
    this.snapshots.push(snapshot)
    return snapshot
  }

  async getLatestByUserId(userId: string): Promise<CreditScoreSnapshot | null> {
    return this.snapshots
      .filter((snapshot) => snapshot.userId === userId)
      .sort((a, b) => b.computedAt.getTime() - a.computedAt.getTime())[0] ?? null
  }

  async getHistoryByUserId(userId: string, limit: number): Promise<CreditScoreSnapshot[]> {
    return this.snapshots
      .filter((snapshot) => snapshot.userId === userId)
      .sort((a, b) => b.computedAt.getTime() - a.computedAt.getTime())
      .slice(0, limit)
  }

  async clear(): Promise<void> {
    this.snapshots = []
  }
}

class PostgresCreditScoreSnapshotStore implements CreditScoreSnapshotStorePort {
  private async pool(): Promise<PgPoolLike> {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async isAvailable(): Promise<boolean> {
    return (await getPool()) !== null
  }

  async create(input: CreateCreditScoreSnapshotInput): Promise<CreditScoreSnapshot> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `INSERT INTO credit_score_snapshots (id, user_id, score, band, factors, computed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING *`,
      [
        randomUUID(),
        input.userId,
        input.score,
        input.band,
        JSON.stringify(input.factors),
        input.computedAt ?? new Date(),
      ],
    )
    return this.mapRow(rows[0] as CreditScoreSnapshotRow)
  }

  async getLatestByUserId(userId: string): Promise<CreditScoreSnapshot | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT * FROM credit_score_snapshots
       WHERE user_id = $1
       ORDER BY computed_at DESC
       LIMIT 1`,
      [userId],
    )
    return rows[0] ? this.mapRow(rows[0] as CreditScoreSnapshotRow) : null
  }

  async getHistoryByUserId(userId: string, limit: number): Promise<CreditScoreSnapshot[]> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT * FROM credit_score_snapshots
       WHERE user_id = $1
       ORDER BY computed_at DESC
       LIMIT $2`,
      [userId, limit],
    )
    return rows.map((row) => this.mapRow(row as CreditScoreSnapshotRow))
  }

  async clear(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('creditScoreSnapshotStore.clear() is only supported in test env')
    }
    const pool = await this.pool()
    await pool.query('TRUNCATE credit_score_snapshots')
  }

  private mapRow(row: CreditScoreSnapshotRow): CreditScoreSnapshot {
    return {
      id: row.id,
      userId: row.user_id,
      score: Number(row.score),
      band: row.band,
      factors: Array.isArray(row.factors)
        ? (row.factors as CreditScoreFactor[])
        : JSON.parse(String(row.factors)) as CreditScoreFactor[],
      computedAt: new Date(row.computed_at),
    }
  }
}

class HybridCreditScoreSnapshotStore implements CreditScoreSnapshotStorePort {
  private memory = new InMemoryCreditScoreSnapshotStore()
  private postgres = new PostgresCreditScoreSnapshotStore()

  private async adapter(): Promise<CreditScoreSnapshotStorePort> {
    if (await this.postgres.isAvailable()) return this.postgres
    return this.memory
  }

  async create(input: CreateCreditScoreSnapshotInput): Promise<CreditScoreSnapshot> {
    return (await this.adapter()).create(input)
  }

  async getLatestByUserId(userId: string): Promise<CreditScoreSnapshot | null> {
    return (await this.adapter()).getLatestByUserId(userId)
  }

  async getHistoryByUserId(userId: string, limit: number): Promise<CreditScoreSnapshot[]> {
    return (await this.adapter()).getHistoryByUserId(userId, limit)
  }

  async clear(): Promise<void> {
    return (await this.adapter()).clear()
  }
}

export const creditScoreSnapshotStore = new HybridCreditScoreSnapshotStore()
