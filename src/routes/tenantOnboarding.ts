/**
 * Tenant onboarding submission — persists verification data and triggers underwriting.
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { submitTenantOnboardingSchema } from '../schemas/tenantOnboarding.js'
import { tenantOnboardingDataStore } from '../models/tenantOnboardingDataStore.js'
import { tenantApplicationStore } from '../models/tenantApplicationStore.js'
import { tenantCreditScoringService } from '../services/tenantCreditScoringService.js'
import { underwritingService } from '../services/underwritingService.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

export function createTenantOnboardingRouter(): Router {
  const router = Router()

  router.post(
    '/submit',
    authenticateToken,
    validate(submitTenantOnboardingSchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = (req as AuthenticatedRequest & { user?: { id: string } }).user?.id
        if (!userId) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
        }

        const body = req.body as import('../schemas/tenantOnboarding.js').SubmitTenantOnboardingRequest
        const application = await tenantApplicationStore.findById(body.applicationId)
        if (!application) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Application not found')
        }
        if (application.userId !== userId) {
          throw new AppError(ErrorCode.FORBIDDEN, 403, 'Access denied')
        }

        tenantOnboardingDataStore.upsert(userId, {
          statedMonthlyIncome: body.statedMonthlyIncome,
          monthlyRent: body.monthlyRent,
          employmentStatus: body.employmentStatus,
          employerName: body.employerName,
          employmentProofText: body.employmentProofText,
          bankStatementLines: body.bankStatementLines,
          mobileMoneyTransactions: body.mobileMoneyTransactions,
        })

        const creditScore = tenantCreditScoringService.computeCompositeScore(userId)

        const underwriting = await underwritingService.evaluateApplication({
          applicationId: body.applicationId,
          metadata: { creditScoreId: creditScore.id, creditBand: creditScore.band },
        })

        res.status(201).json({
          success: true,
          data: {
            creditScore: {
              id: creditScore.id,
              tenantId: creditScore.tenantId,
              score: creditScore.score,
              band: creditScore.band,
              incomeScore: creditScore.incomeScore,
              employmentScore: creditScore.employmentScore,
              bankStatementScore: creditScore.bankStatementScore,
              alternativeDataScore: creditScore.alternativeDataScore,
              computedAt: creditScore.computedAt.toISOString(),
              version: creditScore.version,
            },
            underwriting: {
              decision: underwriting.decision,
              creditBandDecision: underwriting.creditBandDecision,
            },
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
