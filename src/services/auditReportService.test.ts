import { describe, it, expect } from 'vitest'
import {
  matchesAuditFilters,
  parseEventTypeFilter,
  encodeCursor,
  decodeCursor,
  paginateByCursor,
  buildActivityReport,
} from './auditReportService.js'
import type { AuditEntry } from '../repositories/AuditRepository.js'

function entry(overrides: Partial<AuditEntry> & { id: string; createdAt: Date }): AuditEntry {
  return {
    eventType: 'LISTING_APPROVED',
    actorType: 'admin',
    userId: 'admin-1',
    requestId: null,
    ipAddress: null,
    httpMethod: null,
    httpPath: null,
    metadata: {},
    prevHash: 'p',
    eventHash: 'e',
    chainHash: 'c',
    ...overrides,
  } as AuditEntry
}

describe('matchesAuditFilters', () => {
  const e = entry({
    id: '1',
    createdAt: new Date('2026-03-10T12:00:00Z'),
    eventType: 'DISPUTE_RESOLVED',
    actorType: 'admin',
    userId: 'admin-7',
    metadata: { entityType: 'dispute', entityId: 'dispute-42' },
  })

  it('matches a multi-value eventType filter', () => {
    expect(matchesAuditFilters(e, { eventType: ['KYC_APPROVED', 'DISPUTE_RESOLVED'] })).toBe(true)
    expect(matchesAuditFilters(e, { eventType: ['KYC_APPROVED'] })).toBe(false)
  })

  it('matches actor and entity scoping from metadata', () => {
    expect(matchesAuditFilters(e, { actorId: 'admin-7' })).toBe(true)
    expect(matchesAuditFilters(e, { actorId: 'admin-9' })).toBe(false)
    expect(matchesAuditFilters(e, { entityType: 'dispute', entityId: 'dispute-42' })).toBe(true)
    expect(matchesAuditFilters(e, { entityType: 'dispute', entityId: 'dispute-99' })).toBe(false)
  })

  it('excludes events outside the date window', () => {
    expect(matchesAuditFilters(e, { fromDate: new Date('2026-03-01T00:00:00Z'), toDate: new Date('2026-03-31T00:00:00Z') })).toBe(true)
    expect(matchesAuditFilters(e, { fromDate: new Date('2026-03-11T00:00:00Z') })).toBe(false)
    expect(matchesAuditFilters(e, { toDate: new Date('2026-03-09T00:00:00Z') })).toBe(false)
  })
})

describe('parseEventTypeFilter', () => {
  it('parses comma-separated and repeated params', () => {
    expect(parseEventTypeFilter('A,B , C')).toEqual(['A', 'B', 'C'])
    expect(parseEventTypeFilter(['A', 'B'])).toEqual(['A', 'B'])
  })
  it('returns undefined for empty input', () => {
    expect(parseEventTypeFilter(undefined)).toBeUndefined()
    expect(parseEventTypeFilter('  ,  ')).toBeUndefined()
  })
})

describe('cursor pagination', () => {
  const entries = [
    entry({ id: 'a', createdAt: new Date('2026-01-01T00:00:00Z') }),
    entry({ id: 'b', createdAt: new Date('2026-01-02T00:00:00Z') }),
    entry({ id: 'c', createdAt: new Date('2026-01-03T00:00:00Z') }),
    entry({ id: 'd', createdAt: new Date('2026-01-04T00:00:00Z') }),
    entry({ id: 'e', createdAt: new Date('2026-01-05T00:00:00Z') }),
  ]

  it('round-trips a cursor', () => {
    const c = encodeCursor({ id: 'x', createdAt: new Date('2026-01-01T00:00:00Z') })
    expect(decodeCursor(c)).toEqual({ id: 'x', createdAt: '2026-01-01T00:00:00.000Z' })
  })

  it('returns invalid cursors as null', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull()
  })

  it('walks newest-first across pages with no skips or duplicates', () => {
    const page1 = paginateByCursor(entries, { limit: 2 })
    expect(page1.items.map((e) => e.id)).toEqual(['e', 'd'])
    expect(page1.nextCursor).not.toBeNull()

    const page2 = paginateByCursor(entries, { limit: 2, cursor: page1.nextCursor })
    expect(page2.items.map((e) => e.id)).toEqual(['c', 'b'])

    const page3 = paginateByCursor(entries, { limit: 2, cursor: page2.nextCursor })
    expect(page3.items.map((e) => e.id)).toEqual(['a'])
    expect(page3.nextCursor).toBeNull()

    const allIds = [...page1.items, ...page2.items, ...page3.items].map((e) => e.id)
    expect(new Set(allIds).size).toBe(5)
  })

  it('does not skip when a newer event is inserted between page reads', () => {
    const page1 = paginateByCursor(entries, { limit: 2 })
    const withInsert = [...entries, entry({ id: 'f', createdAt: new Date('2026-01-06T00:00:00Z') })]
    const page2 = paginateByCursor(withInsert, { limit: 2, cursor: page1.nextCursor })
    // The freshly inserted 'f' is newer than the cursor, so it is not re-served here.
    expect(page2.items.map((e) => e.id)).toEqual(['c', 'b'])
  })
})

describe('buildActivityReport', () => {
  const entries = [
    entry({ id: '1', createdAt: new Date('2026-02-01T08:00:00Z'), eventType: 'LISTING_APPROVED' }),
    entry({ id: '2', createdAt: new Date('2026-02-01T20:00:00Z'), eventType: 'KYC_APPROVED' }),
    entry({ id: '3', createdAt: new Date('2026-02-02T09:00:00Z'), eventType: 'LISTING_APPROVED' }),
    entry({ id: '4', createdAt: new Date('2026-02-05T09:00:00Z'), eventType: 'DISPUTE_RESOLVED' }),
  ]

  it('aggregates totals by type and by day', () => {
    const report = buildActivityReport(entries)
    expect(report.totalEvents).toBe(4)
    expect(report.byType).toEqual({ LISTING_APPROVED: 2, KYC_APPROVED: 1, DISPUTE_RESOLVED: 1 })
    expect(report.byDay.map((d) => d.date)).toEqual(['2026-02-01', '2026-02-02', '2026-02-05'])
    expect(report.byDay[0]).toEqual({ date: '2026-02-01', total: 2, byType: { LISTING_APPROVED: 1, KYC_APPROVED: 1 } })
  })

  it('honours the date range', () => {
    const report = buildActivityReport(entries, {
      from: new Date('2026-02-02T00:00:00Z'),
      to: new Date('2026-02-03T00:00:00Z'),
    })
    expect(report.totalEvents).toBe(1)
    expect(report.byType).toEqual({ LISTING_APPROVED: 1 })
  })
})
