/**
 * Tenant Rating Card routes
 */

import { Router, Response } from 'express'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'
import { tenantRatingCardStore } from '../models/tenantRatingCardStore.js'
import { dealStore } from '../models/dealStore.js'
import { DealStatus } from '../models/deal.js'
import { createRatingSchema } from '../schemas/tenantRatingCard.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

const router = Router()

/**
 * POST /api/tenant-rating-card/rate/:tenantId
 * Landlord submits a rating after a deal is completed
 */
router.post(
  '/rate/:tenantId',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      if (req.user?.role !== 'landlord') {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only landlords can submit ratings')
      }

      const { tenantId } = req.params
      const validatedData = createRatingSchema.parse(req.body)

      // Verify the deal exists and is completed
      const deal = await dealStore.findById(validatedData.dealId)
      if (!deal) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Deal not found')
      }

      if (deal.status !== DealStatus.COMPLETED) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'Can only rate tenants after a deal is completed',
        )
      }

      // Verify the landlord is part of this deal
      if (deal.landlordId !== req.user.id) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'You are not the landlord for this deal')
      }

      // Verify the tenant matches
      if (deal.tenantId !== tenantId) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Tenant ID does not match the deal')
      }

      // Check if landlord has already rated this deal
      const alreadyRated = await tenantRatingCardStore.hasLandlordRatedDeal(
        req.user.id,
        validatedData.dealId,
      )
      if (alreadyRated) {
        throw new AppError(ErrorCode.CONFLICT, 409, 'You have already rated this tenant for this deal')
      }

      const rating = await tenantRatingCardStore.createRating({
        landlordId: req.user.id,
        tenantId,
        dealId: validatedData.dealId,
        paymentScore: validatedData.paymentScore,
        propertyCareScore: validatedData.propertyCareScore,
        communicationScore: validatedData.communicationScore,
        comment: validatedData.comment,
      })

      res.status(201).json({ success: true, data: rating })
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
      }
      next(error)
    }
  },
)

/**
 * GET /api/tenant-rating-card/:tenantId
 * Tenant views their own rating card
 */
router.get(
  '/:tenantId',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { tenantId } = req.params

      // Tenants can only view their own card
      if (req.user?.id !== tenantId) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'You can only view your own rating card')
      }

      const card = await tenantRatingCardStore.getRatingCard(tenantId)

      if (!card) {
        res.json({
          success: true,
          data: {
            tenantId,
            compositeScore: 0,
            paymentScore: 0,
            propertyCareScore: 0,
            communicationScore: 0,
            totalRatings: 0,
            ratings: [],
          },
        })
        return
      }

      res.json({ success: true, data: card })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/tenant-rating-card/:tenantId/share
 * Tenant generates a one-time shareable access token
 */
router.post(
  '/:tenantId/share',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { tenantId } = req.params

      if (req.user?.id !== tenantId) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'You can only share your own rating card')
      }

      const shareToken = await tenantRatingCardStore.createShareToken(tenantId)

      res.status(201).json({ success: true, data: shareToken })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * GET /api/tenant-rating-card/shared/:token
 * Landlord views a tenant's card via shared token (no auth required)
 */
router.get(
  '/shared/:token',
  async (req: Request, res: Response, next) => {
    try {
      const { token } = req.params

      const shareToken = await tenantRatingCardStore.getShareToken(token)
      if (!shareToken) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Invalid or expired share token')
      }

      const card = await tenantRatingCardStore.getRatingCard(shareToken.tenantId)

      if (!card) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Rating card not found')
      }

      // Return card without PII (no landlord IDs, no deal IDs)
      const publicCard = {
        tenantId: card.tenantId,
        compositeScore: card.compositeScore,
        paymentScore: card.paymentScore,
        propertyCareScore: card.propertyCareScore,
        communicationScore: card.communicationScore,
        totalRatings: card.totalRatings,
        ratings: card.ratings.map((r) => ({
          paymentScore: r.paymentScore,
          propertyCareScore: r.propertyCareScore,
          communicationScore: r.communicationScore,
          comment: r.comment,
          createdAt: r.createdAt,
        })),
      }

      res.json({ success: true, data: publicCard })
    } catch (error) {
      next(error)
    }
  },
)

export function createTenantRatingCardRouter(): Router {
  return router
}
