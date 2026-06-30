import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestAgent, expectRequestId, expectErrorShape } from '../test-helpers.js'
import request from 'supertest'
import { createApp } from '../app.js'
import { InspectionStatus } from '../models/propertyInspection.js'
import { InspectorVerificationStatus } from '../models/inspectorProfile.js'

describe('Property Inspections API', () => {
  const request = createTestAgent()

  describe('POST /api/v1/inspector/apply', () => {
    it('should return 401 without authentication', async () => {
      const response = await request.post('/api/v1/inspector/apply').send({
        bio: 'Experienced property inspector',
        serviceAreas: ['Lagos', 'Abuja']
      })
      expect(response.status).toBe(401)
    })

    it('should return 400 with invalid data', async () => {
      const response = await request
        .post('/api/v1/inspector/apply')
        .set('Authorization', 'Bearer valid-token')
        .send({
          bio: 'Test',
          serviceAreas: [] // Empty service areas should fail validation
        })
      expect(response.status).toBe(400)
    })
  })

  describe('GET /api/v1/inspector/jobs', () => {
    it('should return 401 without authentication', async () => {
      const response = await request.get('/api/v1/inspector/jobs')
      expect(response.status).toBe(401)
    })

    it('should return 200 with jobs array when authenticated', async () => {
      const response = await request
        .get('/api/v1/inspector/jobs')
        .set('Authorization', 'Bearer valid-token')
      expect(response.status).toBe(200)
      expect(Array.isArray(response.body)).toBe(true)
    })
  })

  describe('POST /api/v1/inspector/jobs/:inspectionId/accept', () => {
    it('should return 401 without authentication', async () => {
      const response = await request.post('/api/v1/inspector/jobs/test-id/accept')
      expect(response.status).toBe(401)
    })

    it('should return 404 for non-existent inspection', async () => {
      const response = await request
        .post('/api/v1/inspector/jobs/non-existent-id/accept')
        .set('Authorization', 'Bearer valid-token')
      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/v1/inspector/jobs/:inspectionId/report', () => {
    it('should return 401 without authentication', async () => {
      const response = await request
        .post('/api/v1/inspector/jobs/test-id/report')
        .send({
          checklistItems: [],
          photos: [],
          inspectorNotes: 'Test notes'
        })
      expect(response.status).toBe(401)
    })

    it('should return 400 with invalid report data', async () => {
      const response = await request
        .post('/api/v1/inspector/jobs/test-id/report')
        .set('Authorization', 'Bearer valid-token')
        .send({
          checklistItems: [],
          photos: [],
          inspectorNotes: '' // Empty notes should fail validation
        })
      expect(response.status).toBe(400)
    })
  })

  describe('GET /api/v1/inspector/earnings', () => {
    it('should return 401 without authentication', async () => {
      const response = await request.get('/api/v1/inspector/earnings')
      expect(response.status).toBe(401)
    })

    it('should return 200 with earnings data when authenticated', async () => {
      const response = await request
        .get('/api/v1/inspector/earnings')
        .set('Authorization', 'Bearer valid-token')
      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('completedInspections')
      expect(response.body).toHaveProperty('totalEarnings')
      expect(response.body).toHaveProperty('inspections')
      expect(Array.isArray(response.body.inspections)).toBe(true)
    })
  })

  describe('POST /api/v1/admin/inspections/:inspectionId/review', () => {
    it('should return 401 without authentication', async () => {
      const response = await request
        .post('/api/v1/admin/inspections/test-id/review')
        .send({
          approved: true,
          reviewNotes: 'Approved'
        })
      expect(response.status).toBe(401)
    })

    it('should return 403 for non-admin users', async () => {
      const response = await request
        .post('/api/v1/admin/inspections/test-id/review')
        .set('Authorization', 'Bearer inspector-token')
        .send({
          approved: true,
          reviewNotes: 'Approved'
        })
      expect(response.status).toBe(403)
    })
  })

  describe('GET /api/v1/properties/:propertyId/inspection-summary', () => {
    it('should return 200 for public inspection summary', async () => {
      const response = await request.get('/api/v1/properties/test-property-id/inspection-summary')
      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('inspectionId')
      expect(response.body).toHaveProperty('listingId')
      expect(response.body).toHaveProperty('categoryResults')
      expect(response.body).toHaveProperty('totalItems')
      expect(response.body).toHaveProperty('passCount')
      expect(response.body).toHaveProperty('failCount')
    })

    it('should return 404 for property without inspection', async () => {
      const response = await request.get('/api/v1/properties/non-existent/inspection-summary')
      expect(response.status).toBe(404)
    })
  })
})
