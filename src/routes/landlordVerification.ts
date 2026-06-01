import { Router, Request, Response, NextFunction } from 'express'
import { validate } from '../middleware/validate.js'
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { landlordVerificationSchema } from '../schemas/landlordVerification.js'
import {
  setLandlordVerification,
  getLandlordVerificationPublic,
} from '../services/landlordVerificationService.js'

const adminLandlordVerificationSchema = landlordVerificationSchema.pick({
  verificationLevel: true,
  note: true,
})

function isAdmin(user: any): boolean {
  return user?.role === 'admin' || user?.role === 'super_admin' || user?.isAdmin === true
}

export function createAdminLandlordVerificationRouter() {
  const router = Router()

  router.post(
    '/landlords/:id/verify',
    authenticateToken,
    validate(adminLandlordVerificationSchema, 'body'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        if (!isAdmin(req.user)) {
          throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin access required')
        }

        const landlordId = req.params.id
        const { verificationLevel, note } = req.body

        await setLandlordVerification(req, landlordId, verificationLevel, note)
        res.json({ success: true })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}

export function createLandlordVerificationRouter() {
  const router = Router()

  router.get(
    '/:id/verification-status',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const landlordId = req.params.id
        const status = await getLandlordVerificationPublic(landlordId)

        if (!status) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Landlord not found')
        }

        res.json(status)
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
