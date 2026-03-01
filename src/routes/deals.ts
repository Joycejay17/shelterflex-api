/**
 * Deal management routes
 */

import { Router, Request, Response } from 'express'
import { dealStore } from '../models/dealStore.js'
import { 
  createDealSchema, 
  dealFiltersSchema, 
  updateDealStatusSchema,
  updateScheduleItemSchema,
  CreateDealRequest,
  DealFiltersRequest,
  UpdateDealStatusRequest,
  UpdateScheduleItemRequest
} from '../schemas/deal.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

const router = Router()

/**
 * POST /api/deals
 * Create a new deal with repayment schedule
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const validatedData: CreateDealRequest = createDealSchema.parse(req.body)
    
    const deal = await dealStore.create(validatedData as any)
    
    res.status(201).json({
      success: true,
      data: deal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message)
    }
    throw error
  }
})

/**
 * GET /api/deals/:dealId
 * Get a specific deal by ID with schedule
 */
router.get('/:dealId', async (req: Request, res: Response) => {
  const { dealId } = req.params
  
  if (!dealId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Deal ID is required')
  }
  
  const deal = await dealStore.findById(dealId)
  
  if (!deal) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, `Deal with ID ${dealId} not found`)
  }
  
  res.json({
    success: true,
    data: deal
  })
})

/**
 * GET /api/deals
 * Get deals with optional filtering
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const validatedFilters: DealFiltersRequest = dealFiltersSchema.parse(req.query)
    
    const result = await dealStore.findMany(validatedFilters)
    
    res.json({
      success: true,
      data: result
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message)
    }
    throw error
  }
})

/**
 * PATCH /api/deals/:dealId/status
 * Update deal status
 */
router.patch('/:dealId/status', async (req: Request, res: Response) => {
  const { dealId } = req.params
  
  if (!dealId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Deal ID is required')
  }
  
  try {
    const validatedData: UpdateDealStatusRequest = updateDealStatusSchema.parse(req.body)
    
    const deal = await dealStore.updateStatus(dealId, validatedData.status)
    
    if (!deal) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, `Deal with ID ${dealId} not found`)
    }
    
    res.json({
      success: true,
      data: deal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message)
    }
    throw error
  }
})

/**
 * PATCH /api/deals/:dealId/schedule/:period
 * Update schedule item status
 */
router.patch('/:dealId/schedule/:period', async (req: Request, res: Response) => {
  const { dealId } = req.params
  const period = parseInt(req.params.period, 10)
  
  if (!dealId || isNaN(period)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Deal ID and period are required')
  }
  
  try {
    const validatedData: UpdateScheduleItemRequest = updateScheduleItemSchema.parse({
      ...req.body,
      period
    })
    
    const deal = await dealStore.updateScheduleItemStatus(
      dealId, 
      validatedData.period, 
      validatedData.status as any
    )
    
    if (!deal) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, `Deal with ID ${dealId} not found`)
    }
    
    res.json({
      success: true,
      data: deal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message)
    }
    throw error
  }
})

export function createDealsRouter(): Router {
  return router
}
