import { describe, it, expect } from 'vitest'
import { sanitiseForClient, sanitiseListingForClient } from './sanitiseForClient.js'

describe('sanitiseForClient', () => {
  it('strips PII fields from user objects', () => {
    const user = {
      id: 'u1',
      email: 'test@example.com',
      name: 'Test',
      nin: '12345678901',
      bvn: '22222222222',
      phone: '+2348012345678',
      dateOfBirth: '1990-01-01',
      bankAccountNumber: '0123456789',
      role: 'tenant',
    }

    const safe = sanitiseForClient(user)
    expect(safe.id).toBe('u1')
    expect(safe.email).toBe('test@example.com')
    expect(safe.role).toBe('tenant')
    expect(safe).not.toHaveProperty('nin')
    expect(safe).not.toHaveProperty('bvn')
    expect(safe).not.toHaveProperty('phone')
    expect(safe).not.toHaveProperty('dateOfBirth')
    expect(safe).not.toHaveProperty('bankAccountNumber')
  })

  it('removes negotiatedLandlordRateNgn from tenant-facing listings', () => {
    const listing = {
      listingId: 'l1',
      address: '123 Main St',
      annualRentNgn: 1_200_000,
      negotiatedLandlordRateNgn: 900_000,
    }

    const safe = sanitiseListingForClient(listing)
    expect(safe.listingId).toBe('l1')
    expect(safe.annualRentNgn).toBe(1_200_000)
    expect(safe).not.toHaveProperty('negotiatedLandlordRateNgn')
  })
})
