import { getPool } from '../db.js'
import { OutboxItem, OutboxStatus } from '../outbox/types.js'

export interface DeadLetterEvent {
  id: string
  txType: string
  canonicalExternalRefV1: string
  txId: string
  payload: Record<string, unknown>
  retryCount: number
  deadLetteredAt: Date
  deadLetterReason: string
  createdAt: Date
}

export interface DeadLetterFilters {
  eventType?: string
  startDate?: Date
  endDate?: Date
  page?: number
  limit?: number
}

export interface DeadLetterListResult {
  events: DeadLetterEvent[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export class OutboxRepository {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async add(item: OutboxItem) {
    const pool = await this.pool()
    await pool.query(
      `INSERT INTO outbox_items (aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1,$2,$3,$4)`,
      [item.aggregateType, item.aggregateId, item.eventType, item.payload]
    )
  }

  async fetchPending() {
    const pool = await this.pool()
    const { rows } = await pool.query(`
      SELECT *
      FROM outbox_items
      WHERE status='PENDING' AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY created_at
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `)
    return rows;
  }

  async markProcessed(id: string) {
    const pool = await this.pool()
    await pool.query(
      `UPDATE outbox_items SET status='PROCESSED', processed_at=NOW() WHERE id=$1`,
      [id]
    )
  }

  async markRetry(id: string) {
    const pool = await this.pool()
    await pool.query(
      `UPDATE outbox_items
       SET retry_count = retry_count+1,
           next_retry_at = NOW() + INTERVAL '5 minutes'
       WHERE id=$1`,
      [id]
    )
  }

  /**
   * Move an outbox item to the dead-letter queue.
   * Sets status='dead', records the failure reason and timestamp.
   */
  async moveToDeadLetter(eventId: string, reason: string): Promise<void> {
    const pool = await this.pool()
    await pool.query(
      `UPDATE outbox_items
       SET status             = $2,
           last_error         = $3,
           dead_letter_reason = $3,
           dead_lettered_at   = NOW(),
           next_retry_at      = NULL,
           updated_at         = NOW()
       WHERE id = $1`,
      [eventId, OutboxStatus.DEAD, reason]
    )
  }

  /**
   * List dead-letter events with optional filters and pagination.
   */
  async listDeadLetterEvents(filters: DeadLetterFilters = {}): Promise<DeadLetterListResult> {
    const pool = await this.pool()
    const page = Math.max(1, filters.page ?? 1)
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50))
    const offset = (page - 1) * limit

    const conditions: string[] = [`status = '${OutboxStatus.DEAD}'`]
    const params: unknown[] = []
    let idx = 1

    if (filters.eventType) {
      conditions.push(`event_type = $${idx++}`)
      params.push(filters.eventType)
    }
    if (filters.startDate) {
      conditions.push(`dead_lettered_at >= $${idx++}`)
      params.push(filters.startDate)
    }
    if (filters.endDate) {
      conditions.push(`dead_lettered_at <= $${idx++}`)
      params.push(filters.endDate)
    }

    const where = `WHERE ${conditions.join(' AND ')}`

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM outbox_items ${where}`,
      params,
    )
    const total: number = countResult.rows[0].total

    const dataResult = await pool.query(
      `SELECT id, tx_type, canonical_external_ref_v1, tx_id, payload,
              retry_count, dead_lettered_at, dead_letter_reason, last_error, created_at
       FROM outbox_items
       ${where}
       ORDER BY COALESCE(dead_lettered_at, updated_at) DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset],
    )

    const events: DeadLetterEvent[] = dataResult.rows.map((row) => ({
      id: row.id as string,
      txType: row.tx_type as string,
      canonicalExternalRefV1: row.canonical_external_ref_v1 as string,
      txId: row.tx_id as string,
      payload: (row.payload as Record<string, unknown>) ?? {},
      retryCount: Number(row.retry_count),
      deadLetteredAt: row.dead_lettered_at
        ? new Date(row.dead_lettered_at as string)
        : new Date(row.created_at as string),
      deadLetterReason:
        (row.dead_letter_reason as string | null) ??
        (row.last_error as string | null) ??
        '',
      createdAt: new Date(row.created_at as string),
    }))

    return {
      events,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Re-queue a dead-letter event by resetting its status to pending
   * and clearing attempt counters so the worker picks it up again.
   */
  async requeueDeadLetterEvent(eventId: string): Promise<boolean> {
    const pool = await this.pool()
    const { rowCount } = await pool.query(
      `UPDATE outbox_items
       SET status             = $2,
           retry_count        = 0,
           attempts           = 0,
           last_error         = '',
           dead_letter_reason = NULL,
           dead_lettered_at   = NULL,
           next_retry_at      = NULL,
           updated_at         = NOW()
       WHERE id = $1 AND status = $3`,
      [eventId, OutboxStatus.PENDING, OutboxStatus.DEAD]
    )
    return (rowCount ?? 0) > 0
  }
}

export const outboxRepository = new OutboxRepository()
