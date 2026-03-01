import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { listingStore } from '../models/listingStore.js'
import { ListingStatus } from '../models/listing.js'

describe('Whistleblower Listings API', () => {
  const app = createApp()

  beforeEach(async () => {
    await listingStore.clear()
  })

  describe('POST /api/whistleblower/listings', () => {
    const validListing = {
      whistleblowerId: 'wb-001',
      address: '123 Main Street, Ikeja',
      city: 'Lagos',
      area: 'Ikeja',
      bedrooms: 2,
      bathrooms: 2,
      annualRentNgn: 1200000,
      description: 'Beautiful 2-bedroom apartment',
      photos: [
        'https://example.com/photo1.jpg',
        'https://example.com/photo2.jpg',
        'https://example.com/photo3.jpg',
      ],
    }

    it('should create a listing successfully', async () => {
      const response = await request(app)
        .post('/api/whistleblower/listings')
        .send(validListing)
        .expect(201)

      expect(response.body.success).toBe(true)
      expect(response.body.listing).toBeDefined()
      expect(response.body.listing.listingId).toBeDefined()
      expect(response.body.listing.address).toBe(validListing.address)
      expect(response.body.listing.status).toBe(ListingStatus.PENDING_REVIEW)
      expect(response.body.listing.photos).toHaveLength(3)
    })

    it('should reject listing without address', async () => {
      const response = await request(app)
        .post('/api/whistleblower/listings')
        .send({
          ...validListing,
          address: '',
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(response.body.error.details).toBeDefined()
    })

    it('should reject listing with invalid annual rent (zero)', async () => {
      const response = await request(app)
        .post('/api/whistleblower/listings')
        .send({
          ...validListing,
          annualRentNgn: 0,
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should reject listing with negative annual rent', async () => {
      const response = await request(app)
        .post('/api/whistleblower/listings')
        .send({
          ...validListing,
          annualRentNgn: -1000,
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should reject listing with less than 3 photos', async () => {
      const response = await request(app)
        .post('/api/whistleblower/listings')
        .send({
          ...validListing,
          photos: [
            'https://example.com/photo1.jpg',
            'https://example.com/photo2.jpg',
          ],
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(response.body.error.message).toContain('Invalid request data')
    })

    it('should reject listing with invalid photo URLs', async () => {
      const response = await request(app)
        .post('/api/whistleblower/listings')
        .send({
          ...validListing,
          photos: ['not-a-url', 'also-not-a-url', 'still-not-a-url'],
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should enforce monthly limit (max 2 listings per month)', async () => {
      // Create first listing
      await request(app)
        .post('/api/whistleblower/listings')
        .send(validListing)
        .expect(201)

      // Create second listing
      await request(app)
        .post('/api/whistleblower/listings')
        .send({
          ...validListing,
          address: '456 Another Street',
        })
        .expect(201)

      // Third listing should be rejected
      const response = await request(app)
        .post('/api/whistleblower/listings')
        .send({
          ...validListing,
          address: '789 Third Street',
        })
        .expect(429)

      expect(response.body.error).toBeDefined()
      expect(response.body.error.code).toBe('CONFLICT')
      expect(response.body.error.message).toContain('Monthly listing limit reached')
      expect(response.body.error.details).toBeDefined()
      expect(response.body.error.details.currentCount).toBe(2)
      expect(response.body.error.details.maxAllowed).toBe(2)
    })

    it('should allow different whistleblowers to create listings independently', async () => {
      // Whistleblower 1 creates 2 listings
      await request(app)
        .post('/api/whistleblower/listings')
        .send({ ...validListing, whistleblowerId: 'wb-001' })
        .expect(201)

      await request(app)
        .post('/api/whistleblower/listings')
        .send({ ...validListing, whistleblowerId: 'wb-001', address: '456 Street' })
        .expect(201)

      // Whistleblower 2 should still be able to create listings
      const response = await request(app)
        .post('/api/whistleblower/listings')
        .send({ ...validListing, whistleblowerId: 'wb-002' })
        .expect(201)

      expect(response.body.success).toBe(true)
    })
  })

  describe('GET /api/whistleblower/listings', () => {
    beforeEach(async () => {
      // Create test listings
      await listingStore.create({
        whistleblowerId: 'wb-001',
        address: '123 Main Street',
        city: 'Lagos',
        bedrooms: 2,
        bathrooms: 2,
        annualRentNgn: 1200000,
        photos: ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'],
      })

      await listingStore.create({
        whistleblowerId: 'wb-002',
        address: '456 Second Avenue',
        city: 'Abuja',
        bedrooms: 3,
        bathrooms: 2,
        annualRentNgn: 1500000,
        photos: ['https://example.com/4.jpg', 'https://example.com/5.jpg', 'https://example.com/6.jpg'],
      })
    })

    it('should list all listings', async () => {
      const response = await request(app)
        .get('/api/whistleblower/listings')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.listings).toHaveLength(2)
      expect(response.body.pagination).toBeDefined()
      expect(response.body.pagination.total).toBe(2)
    })

    it('should filter listings by status', async () => {
      const response = await request(app)
        .get('/api/whistleblower/listings?status=pending_review')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.listings).toHaveLength(2)
      expect(response.body.listings.every((l: any) => l.status === 'pending_review')).toBe(true)
    })

    it('should search listings by query', async () => {
      const response = await request(app)
        .get('/api/whistleblower/listings?query=Lagos')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.listings).toHaveLength(1)
      expect(response.body.listings[0].city).toBe('Lagos')
    })

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/whistleblower/listings?page=1&pageSize=1')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.listings).toHaveLength(1)
      expect(response.body.pagination.page).toBe(1)
      expect(response.body.pagination.pageSize).toBe(1)
      expect(response.body.pagination.totalPages).toBe(2)
    })

    it('should reject invalid page size', async () => {
      const response = await request(app)
        .get('/api/whistleblower/listings?pageSize=0')
        .expect(400)

      expect(response.body.error).toBeDefined()
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should reject page size exceeding maximum', async () => {
      const response = await request(app)
        .get('/api/whistleblower/listings?pageSize=101')
        .expect(400)

      expect(response.body.error).toBeDefined()
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /api/whistleblower/listings/:id', () => {
    it('should get a listing by ID', async () => {
      const created = await listingStore.create({
        whistleblowerId: 'wb-001',
        address: '123 Main Street',
        bedrooms: 2,
        bathrooms: 2,
        annualRentNgn: 1200000,
        photos: ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'],
      })

      const response = await request(app)
        .get(`/api/whistleblower/listings/${created.listingId}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.listing).toBeDefined()
      expect(response.body.listing.listingId).toBe(created.listingId)
      expect(response.body.listing.address).toBe('123 Main Street')
    })

    it('should return 404 for non-existent listing', async () => {
      const response = await request(app)
        .get('/api/whistleblower/listings/non-existent-id')
        .expect(404)

      expect(response.body.error).toBeDefined()
      expect(response.body.error.code).toBe('NOT_FOUND')
      expect(response.body.error.message).toContain('not found')
    })
  })
})
