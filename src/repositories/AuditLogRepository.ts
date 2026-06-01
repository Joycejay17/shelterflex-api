/**
 * AuditLogRepository
 *
 * Query-side façade for the audit_log table.
 * Adds a list() method with richer filter options (actorId, action, resourceType,
 * resourceId, date range) and offset-based pagination with a total count —
 * as required by the admin audit log viewer endpoint.
 *
 * Write operations remain in AuditRepository (append-only with hash-chain).
 */

import { getPool } from '../db.js'

export interface AuditLogEntry {
  id: string
  action: string
  actorId: string | null
  actorType: string
  resourceType: string | null
  resourceId: string | null
  ipAddress: string | null
  result: 'success' | 'failure' | string
  metadata: Record<string, unknown>
  createdAt: Date
}

export interface AuditLogFilters {
  actorId?: string
  action?: string
  resourceType?: string
  resourceId?: string
  startDate?: Date
  endDate?: Date
}

export interface AuditLogPagination {
  page?: number
  limit?: number
}

export interface AuditLogListResult {
  entries: AuditLogEntry[]
  total: number
  page: number
  limit: number
  totalPages: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function rowToEntry(row: Record<string, unknown>): AuditLogEntry {
  const metadata = (row.metadata as Record<string, unknown>) ?? {}

  // Derive resourceType / resourceId / result from metadata when no dedicated column exists
  const resourceType =
    (row.resource_type as string | null) ??
    (metadata.resourceType as string | null) ??
    (metadata.resource_type as string | null) ??
    null

  const resourceId =
    (row.resource_id as string | null) ??
    (metadata.resourceId as string | null) ??
    (metadata.resource_id as string | null) ??
    null

  const result =
    (row.result as string | null) ??
    (metadata.result as string | null) ??
    'success'

  return {
    id: row.id as string,
    action: (row.event_type as string) ?? '',
    actorId: (row.user_id as string | null) ?? null,
    actorType: (row.actor_type as string) ?? 'system',
    resourceType,
    resourceId,
    ipAddress: (row.ip_address as string | null) ?? null,
    result,
    metadata,
    createdAt: new Date(row.created_at as string),
  }
}

export class AuditLogRepository {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  /**
   * List audit log entries with optional filters and pagination.
   * Returns entries in descending chronological order.
   */
  async list(
    filters: AuditLogFilters = {},
    pagination: AuditLogPagination = {},
  ): Promise<AuditLogListResult> {
    const pool = await this.pool()
    const page = Math.max(1, pagination.page ?? 1)
    const limit = Math.min(MAX_LIMIT, Math.max(1, pagination.limit ?? DEFAULT_LIMIT))
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (filters.actorId) {
      conditions.push(`user_id = $${idx++}`)
      params.push(filters.actorId)
    }
    if (filters.action) {
      conditions.push(`event_type = $${idx++}`)
      params.push(filters.action)
    }
    if (filters.resourceType) {
      conditions.push(
        `(metadata->>'resourceType' = $${idx} OR metadata->>'resource_type' = $${idx})`,
      )
      params.push(filters.resourceType)
      idx++
    }
    if (filters.resourceId) {
      conditions.push(
        `(metadata->>'resourceId' = $${idx} OR metadata->>'resource_id' = $${idx})`,
      )
      params.push(filters.resourceId)
      idx++
    }
    if (filters.startDate) {
      conditions.push(`created_at >= $${idx++}`)
      params.push(filters.startDate)
    }
    if (filters.endDate) {
      conditions.push(`created_at <= $${idx++}`)
      params.push(filters.endDate)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM audit_log ${where}`,
      params,
    )
    const total: number = countResult.rows[0].total

    const dataResult = await pool.query(
      `SELECT * FROM audit_log ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset],
    )

    return {
      entries: dataResult.rows.map(rowToEntry),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }
}

export const auditLogRepository = new AuditLogRepository()
