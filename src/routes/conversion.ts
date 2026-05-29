import { Router, type Request, type Response, type NextFunction } from 'express'
import type { ConversionRateService } from '../services/conversionRateService.js'

export function createConversionRouter(rateService: ConversionRateService): Router {
  const router = Router()

  /**
   * GET /api/conversion/rate
   * Public endpoint — returns cached USDC/NGN rate (NGN per 1 USDC).
   */
  router.get('/rate', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rate = await rateService.getRate()
      res.json(rate)
    } catch (error) {
      next(error)
    }
  })

  return router
}
