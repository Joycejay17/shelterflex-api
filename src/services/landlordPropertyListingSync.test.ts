import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ListingStatus } from '../models/listing.js'
import { PropertyStatus } from '../models/landlordProperty.js'
import type { LandlordProperty } from '../models/landlordProperty.js'

const mockListingCreate = vi.fn()
const mockListingUpdateStatus = vi.fn()
const mockLandlordPropertyUpdate = vi.fn()

vi.mock('../models/listingStore.js', () => ({
  listingStore: {
    create: (...args: unknown[]) => mockListingCreate(...args),
    updateStatus: (...args: unknown[]) => mockListingUpdateStatus(...args),
  },
}))

vi.mock('../models/landlordPropertyStore.js', () => ({
  landlordPropertyStore: {
    update: (...args: unknown[]) => mockLandlordPropertyUpdate(...args),
  },
}))

const { syncLandlordPropertyListing } = await import('./landlordPropertyListingSync.js')

function makeProperty(overrides: Partial<LandlordProperty> = {}): LandlordProperty {
  return {
    id: 'prop-1',
    landlordId: 'landlord-1',
    title: '2BR Apartment in Lekki',
    address: '12 Admiralty Way',
    city: 'Lagos',
    area: 'Lekki',
    bedrooms: 2,
    bathrooms: 2,
    annualRentNgn: 3000000,
    negotiatedLandlordRateNgn: 2800000,
    outrightPriceNgn: 2700000,
    installmentBasePriceNgn: 300000,
    description: 'Spacious 2BR apartment',
    amenities: [],
    photos: ['photo1.jpg', 'photo2.jpg'],
    primaryPhotoIndex: 0,
    status: PropertyStatus.APPROVED,
    views: 0,
    inquiries: 0,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

describe('syncLandlordPropertyListing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('creating a new listing', () => {
    it('creates a public listing when property is APPROVED and has no listingId', async () => {
      const property = makeProperty({ status: PropertyStatus.APPROVED })
      const createdListing = { listingId: 'listing-1' }
      mockListingCreate.mockResolvedValue(createdListing)
      mockListingUpdateStatus.mockResolvedValue({ ...createdListing, status: ListingStatus.APPROVED })
      mockLandlordPropertyUpdate.mockResolvedValue({ ...property, listingId: 'listing-1' })

      const result = await syncLandlordPropertyListing(property)

      expect(mockListingCreate).toHaveBeenCalledOnce()
      expect(mockListingCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          whistleblowerId: 'landlord-inventory-sync',
          address: '12 Admiralty Way',
          city: 'Lagos',
          area: 'Lekki',
          bedrooms: 2,
          bathrooms: 2,
        }),
      )
      expect(result.listingId).toBe('listing-1')
    })

    it('creates a public listing for PENDING_REVIEW property', async () => {
      const property = makeProperty({ status: PropertyStatus.PENDING_REVIEW })
      const createdListing = { listingId: 'listing-pending' }
      mockListingCreate.mockResolvedValue(createdListing)
      mockLandlordPropertyUpdate.mockResolvedValue({ ...property, listingId: 'listing-pending' })

      const result = await syncLandlordPropertyListing(property)

      expect(mockListingCreate).toHaveBeenCalledOnce()
      expect(mockListingUpdateStatus).not.toHaveBeenCalledWith(
        'listing-pending',
        ListingStatus.APPROVED,
        expect.anything(),
      )
      expect(result.listingId).toBe('listing-pending')
    })

    it('orders photos with primary photo first', async () => {
      const property = makeProperty({
        photos: ['second.jpg', 'primary.jpg', 'third.jpg'],
        primaryPhotoIndex: 1,
      })
      mockListingCreate.mockResolvedValue({ listingId: 'listing-photos' })
      mockLandlordPropertyUpdate.mockResolvedValue({ ...property, listingId: 'listing-photos' })

      await syncLandlordPropertyListing(property)

      expect(mockListingCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          photos: ['primary.jpg', 'second.jpg', 'third.jpg'],
        }),
      )
    })
  })

  describe('editing propagates to listing', () => {
    it('updates the listing status when property already has a listingId', async () => {
      const property = makeProperty({
        status: PropertyStatus.APPROVED,
        listingId: 'listing-existing',
      })

      await syncLandlordPropertyListing(property)

      expect(mockListingUpdateStatus).toHaveBeenCalledWith(
        'listing-existing',
        ListingStatus.APPROVED,
      )
      expect(mockListingCreate).not.toHaveBeenCalled()
    })

    it('maps RENTED property status to RENTED listing status', async () => {
      const property = makeProperty({
        status: PropertyStatus.RENTED,
        listingId: 'listing-rented',
      })

      await syncLandlordPropertyListing(property)

      expect(mockListingUpdateStatus).toHaveBeenCalledWith(
        'listing-rented',
        ListingStatus.RENTED,
      )
    })

    it('maps PENDING_REVIEW property to PENDING_REVIEW listing', async () => {
      const property = makeProperty({
        status: PropertyStatus.PENDING_REVIEW,
        listingId: 'listing-pr',
      })

      await syncLandlordPropertyListing(property)

      expect(mockListingUpdateStatus).toHaveBeenCalledWith(
        'listing-pr',
        ListingStatus.PENDING_REVIEW,
      )
    })
  })

  describe('unpublishing/removing listing', () => {
    it('sets listing to REJECTED when property is DEACTIVATED', async () => {
      const property = makeProperty({
        status: PropertyStatus.DEACTIVATED,
        listingId: 'listing-deact',
      })

      await syncLandlordPropertyListing(property)

      expect(mockListingUpdateStatus).toHaveBeenCalledWith(
        'listing-deact',
        ListingStatus.REJECTED,
        'Deactivated by landlord',
      )
      expect(mockLandlordPropertyUpdate).not.toHaveBeenCalled()
    })

    it('returns property without changes if DEACTIVATED and no listingId', async () => {
      const property = makeProperty({
        status: PropertyStatus.DEACTIVATED,
        listingId: undefined,
      })

      const result = await syncLandlordPropertyListing(property)

      expect(mockListingUpdateStatus).not.toHaveBeenCalled()
      expect(mockListingCreate).not.toHaveBeenCalled()
      expect(result.listingId).toBeUndefined()
    })
  })

  describe('idempotency', () => {
    it('does not create a duplicate listing when property already has a listingId', async () => {
      const property = makeProperty({
        status: PropertyStatus.APPROVED,
        listingId: 'listing-123',
      })

      await syncLandlordPropertyListing(property)

      expect(mockListingCreate).not.toHaveBeenCalled()
      expect(mockListingUpdateStatus).toHaveBeenCalledWith('listing-123', ListingStatus.APPROVED)
    })

    it('calling sync twice with same property produces no spurious writes', async () => {
      const property = makeProperty({
        status: PropertyStatus.APPROVED,
        listingId: 'listing-idem',
      })

      await syncLandlordPropertyListing(property)
      await syncLandlordPropertyListing(property)

      expect(mockListingUpdateStatus).toHaveBeenCalledTimes(2)
      expect(mockListingCreate).not.toHaveBeenCalled()
      expect(mockLandlordPropertyUpdate).not.toHaveBeenCalled()
    })
  })

  describe('no-op states', () => {
    it('returns property unchanged for inactive/unknown statuses without listingId', async () => {
      const property = makeProperty({
        status: PropertyStatus.INACTIVE,
        listingId: undefined,
      })

      const result = await syncLandlordPropertyListing(property)

      expect(mockListingCreate).not.toHaveBeenCalled()
      expect(mockListingUpdateStatus).not.toHaveBeenCalled()
      expect(result).toEqual(property)
    })

    it('returns property unchanged for statuses with no matching listing status', async () => {
      const property = makeProperty({
        status: PropertyStatus.PENDING,
        listingId: undefined,
      })

      const result = await syncLandlordPropertyListing(property)

      expect(mockListingCreate).not.toHaveBeenCalled()
      expect(mockListingUpdateStatus).not.toHaveBeenCalled()
    })
  })

  describe('partial failure handling', () => {
    it('propagates listing creation failure', async () => {
      const property = makeProperty({ status: PropertyStatus.APPROVED })
      mockListingCreate.mockRejectedValue(new Error('DB write failed'))

      await expect(syncLandlordPropertyListing(property)).rejects.toThrow('DB write failed')
      expect(mockLandlordPropertyUpdate).not.toHaveBeenCalled()
    })

    it('propagates listing updateStatus failure', async () => {
      const property = makeProperty({
        status: PropertyStatus.APPROVED,
        listingId: 'listing-fail',
      })
      mockListingUpdateStatus.mockRejectedValue(new Error('update failed'))

      await expect(syncLandlordPropertyListing(property)).rejects.toThrow('update failed')
    })

    it('propagates landlordPropertyStore.update failure', async () => {
      const property = makeProperty({ status: PropertyStatus.APPROVED })
      mockListingCreate.mockResolvedValue({ listingId: 'listing-new' })
      mockLandlordPropertyUpdate.mockRejectedValue(new Error('property update failed'))

      await expect(syncLandlordPropertyListing(property)).rejects.toThrow('property update failed')
    })
  })

  describe('photo ordering edge cases', () => {
    it('handles property with no photos', async () => {
      const property = makeProperty({ photos: [], primaryPhotoIndex: 0 })
      mockListingCreate.mockResolvedValue({ listingId: 'listing-nophoto' })
      mockLandlordPropertyUpdate.mockResolvedValue({ ...property, listingId: 'listing-nophoto' })

      await syncLandlordPropertyListing(property)

      expect(mockListingCreate).toHaveBeenCalledWith(
        expect.objectContaining({ photos: [] }),
      )
    })

    it('clamps primaryPhotoIndex to valid range', async () => {
      const property = makeProperty({
        photos: ['only.jpg'],
        primaryPhotoIndex: 5,
      })
      mockListingCreate.mockResolvedValue({ listingId: 'listing-clamp' })
      mockLandlordPropertyUpdate.mockResolvedValue({ ...property, listingId: 'listing-clamp' })

      await syncLandlordPropertyListing(property)

      expect(mockListingCreate).toHaveBeenCalledWith(
        expect.objectContaining({ photos: ['only.jpg'] }),
      )
    })
  })
})
