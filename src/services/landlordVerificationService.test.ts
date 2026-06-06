import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setLandlordVerification, getLandlordVerificationPublic } from './landlordVerificationService.js'
import { getPool } from '../db.js'
import { auditLog } from '../utils/auditLogger.js'
import { notificationService } from './notificationService.js'

vi.mock('../db.js', () => ({
  getPool: vi.fn(),
}))
vi.mock('../utils/auditLogger.js', () => ({
  auditLog: vi.fn(),
  extractAuditContext: vi.fn(() => ({
    userId: 'admin-1',
    requestId: 'req-1',
    ip: '127.0.0.1',
    actorType: 'admin',
    httpMethod: 'POST',
    httpPath: '/api',
  })),
}))
vi.mock('./notificationService.js', () => ({
  notificationService: {
    create: vi.fn(),
  },
}))

describe('landlordVerificationService', () => {
  let mockPool: { query: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPool = { query: vi.fn() }
    ;(getPool as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockPool)
  })

  it('updates verification level and sends notification', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    const req = {
      user: { id: 'admin-1' },
      requestId: 'req-1',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      method: 'POST',
      path: '/api',
    }

    await setLandlordVerification(req, 'landlord-1', 'id_verified', 'Approved documents')

    expect(mockPool.query).toHaveBeenCalledTimes(1)
    expect(mockPool.query.mock.calls[0][0]).toContain('INSERT INTO landlord_profiles')
    expect(mockPool.query.mock.calls[0][1]).toEqual([
      'landlord-1',
      'id_verified',
      expect.any(String),
    ])
    expect(auditLog).toHaveBeenCalledWith('LANDLORD_VERIFICATION_UPDATED',
      expect.objectContaining({ userId: 'admin-1', actorType: 'admin' }),
      expect.objectContaining({ landlordId: 'landlord-1', level: 'id_verified', note: 'Approved documents' }),
    )
    expect(notificationService.create).toHaveBeenCalledWith('landlord-1',
      expect.objectContaining({
        category: 'landlord_verification',
        title: 'Landlord verification status changed',
        body: 'Your verification status was updated to id_verified',
        data: { level: 'id_verified', note: 'Approved documents' },
        dedupeKey: 'landlord_verification:landlord-1',
      }),
    )
  })

  it('returns unverified when no verification record exists', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ user_id: 'landlord-1', level: null, verified_at: null }] })

    const status = await getLandlordVerificationPublic('landlord-1')

    expect(mockPool.query).toHaveBeenCalledTimes(1)
    expect(mockPool.query.mock.calls[0][0]).toContain('LEFT JOIN landlord_profiles')
    expect(status).toEqual({ level: 'unverified', verifiedAt: null })
  })

  it('returns null when landlord is not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    const status = await getLandlordVerificationPublic('landlord-1')
    expect(status).toBeNull()
  })
})
