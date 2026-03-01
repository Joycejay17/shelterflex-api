import { Router, type Request, type Response, type NextFunction } from 'express'
import { validate } from '../middleware/validate.js'
import { createListingSchema, listingFiltersSchema } from '../schemas/listing.js'
import { listingStore } from '../models/listingStore.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

export function createWhistleblowerRouter() {
  const router = Router()

  /**
   * POST /api/whistleblower/listings
   * 
   * Create a new listing
   * 
   * Rules:
   * - Address required
   * - Annual rent must be > 0
   * - At least 3 photos required
   * - Max 2 reports per whistleblower per month
   */
  router.post(
    '/listings',
    validate(createListingSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const input = req.body

        logger.info('Creating new listing', {
          whistleblowerId: input.whistleblowerId,
          address: input.address,
          requestId: req.requestId,
        })

        // Check monthly limit
        const hasReachedLimit = await listingStore.hasReachedMonthlyLimit(
          input.whistleblowerId,
        )

        if (hasReachedLimit) {
          const currentCount = await listingStore.getMonthlyReportCount(
            input.whistleblowerId,
          )
          
          throw new AppError(
            ErrorCode.CONFLICT,
            429,
            'Monthly listing limit reached',
            {
              currentCount,
              maxAllowed: 2,
              message: 'You have reached the maximum of 2 listings per month',
            },
          )
        }

        // Create listing
        const listing = await listingStore.create(input)

        logger.info('Listing created successfully', {
          listingId: listing.listingId,
          whistleblowerId: listing.whistleblowerId,
          requestId: req.requestId,
        })

        res.status(201).json({
          success: true,
          listing: {
            listingId: listing.listingId,
            whistleblowerId: listing.whistleblowerId,
            address: listing.address,
            city: listing.city,
            area: listing.area,
            bedrooms: listing.bedrooms,
            bathrooms: listing.bathrooms,
            annualRentNgn: listing.annualRentNgn,
            description: listing.description,
            photos: listing.photos,
            status: listing.status,
            createdAt: listing.createdAt.toISOString(),
            updatedAt: listing.updatedAt.toISOString(),
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/whistleblower/listings
   * 
   * List listings with optional filters
   * Query params:
   *   - status: pending_review | approved | rejected | rented
   *   - query: search term
   *   - page: page number (default 1)
   *   - pageSize: items per page (default 20, max 100)
   */
  router.get(
    '/listings',
    validate(listingFiltersSchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const filters = req.query

        logger.info('Listing listings', {
          filters,
          requestId: req.requestId,
        })

        const result = await listingStore.list(filters)

        res.json({
          success: true,
          listings: result.listings.map((listing) => ({
            listingId: listing.listingId,
            whistleblowerId: listing.whistleblowerId,
            address: listing.address,
            city: listing.city,
            area: listing.area,
            bedrooms: listing.bedrooms,
            bathrooms: listing.bathrooms,
            annualRentNgn: listing.annualRentNgn,
            description: listing.description,
            photos: listing.photos,
            status: listing.status,
            createdAt: listing.createdAt.toISOString(),
            updatedAt: listing.updatedAt.toISOString(),
            rejectionReason: listing.rejectionReason,
          })),
          pagination: {
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            totalPages: result.totalPages,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/whistleblower/listings/:id
   * 
   * Get a single listing by ID
   */
  router.get(
    '/listings/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params

        logger.info('Getting listing', {
          listingId: id,
          requestId: req.requestId,
        })

        const listing = await listingStore.getById(id)

        if (!listing) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            404,
            `Listing with ID '${id}' not found`,
          )
        }

        res.json({
          success: true,
          listing: {
            listingId: listing.listingId,
            whistleblowerId: listing.whistleblowerId,
            address: listing.address,
            city: listing.city,
            area: listing.area,
            bedrooms: listing.bedrooms,
            bathrooms: listing.bathrooms,
            annualRentNgn: listing.annualRentNgn,
            description: listing.description,
            photos: listing.photos,
            status: listing.status,
            createdAt: listing.createdAt.toISOString(),
            updatedAt: listing.updatedAt.toISOString(),
            rejectionReason: listing.rejectionReason,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
