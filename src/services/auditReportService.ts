/**
 * Admin audit-trail querying & reporting helpers — issue #909.
 *
 * Pure helpers that back the admin audit API:
 *   - `matchesAuditFilters` — predicate supporting multi-value eventType,
 *     actor, entity scoping (read from metadata.entityType/entityId), and a
 *     date window.
 *   - cursor-based pagination (`encodeCursor`/`decodeCursor`/`paginateByCursor`)
 *     so large, live audit sets page without offset skips.
 *   - `buildActivityReport` — events aggregated by type and by day over a range.
 *
 * These operate on already-fetched `AuditEntry` records (see AuditRepository),
 * keeping query patterns in the repository and reporting logic testable here.
 */

import type { AuditEntry } from '../repositories/AuditRepository.js'

export interface AuditTrailFilters {
  /** One or more event types (OR-matched). */
  eventType?: string[]
  actorType?: string
  /** Maps to AuditEntry.userId. */
  actorId?: string
  entityType?: string
  entityId?: string
  fromDate?: Date
  toDate?: Date
}

function entityFieldsOf(entry: AuditEntry): { entityType?: string; entityId?: string } {
  const md = entry.metadata ?? {}
  const entityType = typeof md.entityType === 'string' ? md.entityType : undefined
  const entityId =
    typeof md.entityId === 'string'
      ? md.entityId
      : typeof md.entityId === 'number'
        ? String(md.entityId)
        : undefined
  return { entityType, entityId }
}

/** True when an entry satisfies every supplied filter (absent filters ignored). */
export function matchesAuditFilters(entry: AuditEntry, filters: AuditTrailFilters): boolean {
  if (filters.eventType && filters.eventType.length > 0 && !filters.eventType.includes(entry.eventType)) {
    return false
  }
  if (filters.actorType && entry.actorType !== filters.actorType) return false
  if (filters.actorId && entry.userId !== filters.actorId) return false

  if (filters.entityType || filters.entityId) {
    const { entityType, entityId } = entityFieldsOf(entry)
    if (filters.entityType && entityType !== filters.entityType) return false
    if (filters.entityId && entityId !== filters.entityId) return false
  }

  const ts = entry.createdAt.getTime()
  if (filters.fromDate && ts < filters.fromDate.getTime()) return false
  if (filters.toDate && ts > filters.toDate.getTime()) return false

  return true
}

/**
 * Parse a multi-value eventType filter from a query value: accepts a repeated
 * param (string[]) or a single comma-separated string. Returns undefined when
 * nothing usable is supplied.
 */
export function parseEventTypeFilter(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const raw = Array.isArray(value) ? value : value.split(',')
  const cleaned = raw.map((v) => v.trim()).filter((v) => v.length > 0)
  return cleaned.length > 0 ? cleaned : undefined
}

// ---- Cursor pagination ----------------------------------------------------

export interface AuditCursor {
  createdAt: string
  id: string
}

export function encodeCursor(entry: Pick<AuditEntry, 'createdAt' | 'id'>): string {
  const payload: AuditCursor = { createdAt: entry.createdAt.toISOString(), id: entry.id }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string): AuditCursor | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as AuditCursor
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') return parsed
    return null
  } catch {
    return null
  }
}

/** Sort key: newest first, breaking ties by id descending for stability. */
function isOlderThanCursor(entry: AuditEntry, cursor: AuditCursor): boolean {
  const entryTs = entry.createdAt.getTime()
  const cursorTs = new Date(cursor.createdAt).getTime()
  if (entryTs !== cursorTs) return entryTs < cursorTs
  return entry.id < cursor.id
}

export interface CursorPage {
  items: AuditEntry[]
  nextCursor: string | null
}

/**
 * Cursor-paginate a set of entries newest-first. The cursor encodes the last
 * returned (createdAt, id), so live inserts at the head never cause skips or
 * duplicates within an in-progress walk.
 */
export function paginateByCursor(
  entries: AuditEntry[],
  options: { limit: number; cursor?: string | null },
): CursorPage {
  const limit = Math.max(1, options.limit)
  const sorted = [...entries].sort((a, b) => {
    const diff = b.createdAt.getTime() - a.createdAt.getTime()
    return diff !== 0 ? diff : b.id.localeCompare(a.id)
  })

  let windowed = sorted
  if (options.cursor) {
    const decoded = decodeCursor(options.cursor)
    if (decoded) windowed = sorted.filter((e) => isOlderThanCursor(e, decoded))
  }

  const items = windowed.slice(0, limit)
  const nextCursor =
    windowed.length > limit && items.length > 0 ? encodeCursor(items[items.length - 1]) : null
  return { items, nextCursor }
}

// ---- Activity report ------------------------------------------------------

export interface ActivityReportDay {
  date: string // YYYY-MM-DD (UTC)
  total: number
  byType: Record<string, number>
}

export interface ActivityReport {
  from: string | null
  to: string | null
  totalEvents: number
  byType: Record<string, number>
  byDay: ActivityReportDay[]
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Aggregate audit events by type and by UTC day over an optional date range.
 * Days with no events are omitted; `byDay` is sorted ascending by date.
 */
export function buildActivityReport(
  entries: AuditEntry[],
  range: { from?: Date; to?: Date } = {},
): ActivityReport {
  const inRange = entries.filter((e) =>
    matchesAuditFilters(e, { fromDate: range.from, toDate: range.to }),
  )

  const byType: Record<string, number> = {}
  const dayMap = new Map<string, ActivityReportDay>()

  for (const e of inRange) {
    byType[e.eventType] = (byType[e.eventType] ?? 0) + 1

    const day = utcDay(e.createdAt)
    let bucket = dayMap.get(day)
    if (!bucket) {
      bucket = { date: day, total: 0, byType: {} }
      dayMap.set(day, bucket)
    }
    bucket.total += 1
    bucket.byType[e.eventType] = (bucket.byType[e.eventType] ?? 0) + 1
  }

  const byDay = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  return {
    from: range.from ? range.from.toISOString() : null,
    to: range.to ? range.to.toISOString() : null,
    totalEvents: inRange.length,
    byType,
    byDay,
  }
}
