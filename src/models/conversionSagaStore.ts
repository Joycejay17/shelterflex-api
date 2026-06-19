import { randomUUID } from 'node:crypto'
import {
  type ConversionSagaRecord,
  type ConversionSagaState,
  type CreateConversionSagaInput,
} from './conversionSaga.js'
import { getPool } from '../db.js'

function mapRow(row: Record<string, unknown>): ConversionSagaRecord {
  return {
    sagaId: String(row.saga_id),
    depositId: String(row.deposit_id),
    userId: String(row.user_id),
    kind: row.kind as ConversionSagaRecord['kind'],
    amountNgn: Number(row.amount_ngn),
    amountUsdc: String(row.amount_usdc),
    lockedRate: Number(row.locked_rate),
    rateExpiresAt: new Date(row.rate_expires_at as string),
    provider: row.provider as ConversionSagaRecord['provider'],
    providerRef: String(row.provider_ref ?? ''),
    state: row.state as ConversionSagaState,
    compensationRef: (row.compensation_ref as string) ?? null,
    failureReason: (row.failure_reason as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

/**
 * Durable store for {@link ConversionSagaRecord}.
 *
 * Mirrors the persistence strategy of {@link ../models/conversionStore.ts}:
 * a Postgres-backed table when a pool is available, an in-memory map otherwise
 * (tests / local). One saga per `deposit_id` (unique), which gives us
 * once-per-deposit semantics for free.
 */
class ConversionSagaStore {
  private byId = new Map<string, ConversionSagaRecord>()
  private byDepositId = new Map<string, string>()

  private async pool() {
    return getPool()
  }

  async getById(sagaId: string): Promise<ConversionSagaRecord | null> {
    const pool = await this.pool()
    if (!pool) return this.byId.get(sagaId) ?? null
    const { rows } = await pool.query(`SELECT * FROM conversion_sagas WHERE saga_id = $1`, [sagaId])
    return rows[0] ? mapRow(rows[0]) : null
  }

  async getByDepositId(depositId: string): Promise<ConversionSagaRecord | null> {
    const pool = await this.pool()
    if (!pool) {
      const id = this.byDepositId.get(depositId)
      return id ? this.byId.get(id) ?? null : null
    }
    const { rows } = await pool.query(
      `SELECT * FROM conversion_sagas WHERE deposit_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [depositId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  /**
   * Idempotently create a saga in `quote_locked` for a deposit. If one already
   * exists for the deposit, the existing record is returned unchanged (the
   * locked rate is therefore preserved across retries — recovery reuses the
   * original price rather than re-quoting).
   */
  async createQuoteLocked(input: CreateConversionSagaInput): Promise<ConversionSagaRecord> {
    const pool = await this.pool()
    if (!pool) {
      // Synchronous check-and-set: no await between the lookup and the insert,
      // so concurrent creators for the same deposit converge on one saga
      // (matches the Postgres unique-deposit-id guarantee).
      const existingId = this.byDepositId.get(input.depositId)
      if (existingId) {
        const existing = this.byId.get(existingId)
        if (existing) return existing
      }

      const now = new Date()
      const record: ConversionSagaRecord = {
        sagaId: randomUUID(),
        depositId: input.depositId,
        userId: input.userId,
        kind: input.kind,
        amountNgn: input.amountNgn,
        amountUsdc: '0',
        lockedRate: input.lockedRate,
        rateExpiresAt: input.rateExpiresAt,
        provider: input.provider,
        providerRef: '',
        state: 'quote_locked',
        compensationRef: null,
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      }
      this.byId.set(record.sagaId, record)
      this.byDepositId.set(record.depositId, record.sagaId)
      return record
    }

    const { rows } = await pool.query(
      `INSERT INTO conversion_sagas
         (deposit_id, user_id, kind, amount_ngn, locked_rate, rate_expires_at, provider)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7)
       ON CONFLICT (deposit_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [
        input.depositId,
        input.userId,
        input.kind,
        Math.trunc(input.amountNgn),
        input.lockedRate,
        input.rateExpiresAt.toISOString(),
        input.provider,
      ],
    )
    return mapRow(rows[0])
  }

  /**
   * Advance the saga state, optionally persisting derived fields.
   *
   * `expectedState` makes the update conditional (compare-and-set): if the
   * persisted state no longer matches, the write is skipped and the current
   * record is returned. This prevents a slow concurrent attempt from clobbering
   * a state already advanced by the winner (lost-update protection).
   */
  async transition(
    sagaId: string,
    state: ConversionSagaState,
    patch: {
      amountUsdc?: string
      providerRef?: string
      compensationRef?: string
      failureReason?: string | null
      expectedState?: ConversionSagaState
    } = {},
  ): Promise<ConversionSagaRecord | null> {
    const pool = await this.pool()
    if (!pool) {
      const existing = this.byId.get(sagaId)
      if (!existing) return null
      if (patch.expectedState !== undefined && existing.state !== patch.expectedState) {
        return existing // CAS miss — leave the winner's state intact
      }
      const updated: ConversionSagaRecord = {
        ...existing,
        state,
        amountUsdc: patch.amountUsdc ?? existing.amountUsdc,
        providerRef: patch.providerRef ?? existing.providerRef,
        compensationRef: patch.compensationRef ?? existing.compensationRef,
        failureReason:
          patch.failureReason === undefined ? existing.failureReason : patch.failureReason,
        updatedAt: new Date(),
      }
      this.byId.set(sagaId, updated)
      return updated
    }

    const params: unknown[] = [
      sagaId,
      state,
      patch.amountUsdc ?? null,
      patch.providerRef ?? null,
      patch.compensationRef ?? null,
      patch.failureReason === undefined ? null : patch.failureReason,
    ]
    let guard = ''
    if (patch.expectedState !== undefined) {
      params.push(patch.expectedState)
      guard = ` AND state = $${params.length}`
    }

    const { rows } = await pool.query(
      `UPDATE conversion_sagas
       SET state           = $2,
           amount_usdc     = COALESCE($3, amount_usdc),
           provider_ref    = COALESCE($4, provider_ref),
           compensation_ref = COALESCE($5, compensation_ref),
           failure_reason  = $6,
           updated_at      = NOW()
       WHERE saga_id = $1${guard}
       RETURNING *`,
      params,
    )
    if (rows[0]) return mapRow(rows[0])
    // CAS miss (or row gone): return the latest record so callers see truth.
    return this.getById(sagaId)
  }

  /** Sagas stuck mid-flight (for a recovery worker / admin tooling). */
  async listInFlight(limit = 100): Promise<ConversionSagaRecord[]> {
    const inFlight: ConversionSagaState[] = [
      'fiat_committed',
      'onchain_submitted',
      'onchain_confirmed',
      'compensating',
    ]
    const pool = await this.pool()
    if (!pool) {
      return Array.from(this.byId.values())
        .filter((r) => inFlight.includes(r.state))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit)
    }
    const { rows } = await pool.query(
      `SELECT * FROM conversion_sagas WHERE state = ANY($1) ORDER BY created_at ASC LIMIT $2`,
      [inFlight, limit],
    )
    return rows.map(mapRow)
  }

  async clear(): Promise<void> {
    const pool = await this.pool()
    if (pool) {
      await pool.query('DELETE FROM conversion_sagas')
      return
    }
    this.byId.clear()
    this.byDepositId.clear()
  }
}

export const conversionSagaStore = new ConversionSagaStore()
