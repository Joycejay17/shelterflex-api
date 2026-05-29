import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import { kycSubmissionSchema, kycStatusSchema } from '../schemas/kyc.js'
import { kycRepository, MAX_ATTEMPTS } from '../repositories/KycRepository.js'
import { createKycProvider } from '../services/kycProvider.js'
import { authenticateToken } from '../middleware/auth.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { auditLog, extractAuditContext, type AuditEventType } from '../utils/auditLogger.js'
import { emitKycStatusChanged } from '../services/index.js'
import { logger } from '../utils/logger.js'

function requireAdmin(req: Request): void {
  const user = (req as any).user
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin access required')
  }
}

const router = Router()
const kycProvider = createKycProvider()

router.post(
  '/',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = kycSubmissionSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid submission')
      }

      const userId = (req as any).user.id as string
      const submission = parsed.data

      const existing = await kycRepository.findByUserId(userId)
      if (existing && existing.status === 'pending') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'KYC already pending')
      }
      if (existing && existing.status === 'in_review') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'KYC currently in review')
      }
      if (existing && existing.attemptCount >= MAX_ATTEMPTS) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'KYC_MAX_ATTEMPTS_REACHED', {
          attemptsRemaining: 0,
          maxAttempts: MAX_ATTEMPTS,
        })
      }

      let record
      try {
        record = await kycRepository.create(userId, submission)
      } catch (err: any) {
        if (err.message === 'MAX_ATTEMPTS_EXCEEDED') {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'KYC_MAX_ATTEMPTS_REACHED', {
            attemptsRemaining: 0,
            maxAttempts: MAX_ATTEMPTS,
          })
        }
        throw err
      }

      try {
        const result = await kycProvider.submit(submission)
        if (result.success && result.externalId) {
          await kycRepository.updateStatus(
            record.id,
            'in_review',
            kycProvider.name,
            result.externalId,
          )
        }
      } catch (providerError) {
        logger.warn('kyc.provider_error', { error: providerError })
      }

      auditLog('KYC_SUBMITTED' as AuditEventType, extractAuditContext(req, 'user'), {
        recordId: record.id,
        documentType: submission.documentType,
        attemptCount: record.attemptCount,
      })

      res.status(201).json({
        success: true,
        recordId: record.id,
        attemptsRemaining: MAX_ATTEMPTS - record.attemptCount,
      })
    } catch (error) {
      next(error)
    }
  },
)

router.get(
  '/status',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user.id as string
      const record = await kycRepository.findByUserId(userId)

      if (!record) {
        return res.json({ status: 'not_submitted', attemptsRemaining: MAX_ATTEMPTS })
      }

      res.json({
        status: record.status,
        documentType: record.documentType,
        rejectionReason: record.rejectionReason,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        expiresAt: record.expiresAt,
        attemptsRemaining: Math.max(0, MAX_ATTEMPTS - record.attemptCount),
      })
    } catch (error) {
      next(error)
    }
  },
)

router.post(
  '/webhook',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = req.body

      if (!kycProvider.webhookAuthenticate(payload)) {
        logger.warn('kyc.webhook_unauthorized', { payload })
        return res.status(401).json({ error: 'Unauthorized' })
      }

      const { id, status, reason } = payload as { id: string; status: string; reason?: string }
      const record = await kycRepository.findById(id)

      if (!record) {
        logger.warn('kyc.webhook_record_not_found', { id })
        return res.status(404).json({ error: 'Not found' })
      }

      const newStatus = kycStatusSchema.parse(status)
      await kycRepository.updateStatus(record.id, newStatus, undefined, undefined, reason)

      await emitKycStatusChanged(record.userId, newStatus)

      res.json({ received: true })
    } catch (error) {
      next(error)
    }
  },
)

router.get(
  '/admin',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      const { status, userId, page, pageSize } = req.query
      const result = await kycRepository.list({
        status: status as any,
        userId: userId as string,
        page: parseInt(page as string) || 1,
        pageSize: parseInt(pageSize as string) || 50,
      })

      res.json(result)
    } catch (error) {
      next(error)
    }
  },
)

router.post(
  '/admin/:recordId/approve',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      const { recordId } = req.params
      const adminId = (req as any).user.id as string
      const { reason } = req.body as { reason?: string }

      const record = await kycRepository.findById(recordId)
      if (!record) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'KYC record not found')
      }

      if (record.status !== 'pending' && record.status !== 'in_review') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Cannot approve in current state')
      }

      await kycRepository.updateStatus(recordId, 'approved', undefined, undefined, reason, adminId)

      auditLog('KYC_APPROVED' as AuditEventType, extractAuditContext(req, 'admin'), {
        recordId,
        userId: record.userId,
      })

      await emitKycStatusChanged(record.userId, 'approved')

      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  },
)

router.post(
  '/admin/:recordId/reject',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      const { recordId } = req.params
      const adminId = (req as any).user.id as string
      const { reason } = req.body as { reason?: string }

      const record = await kycRepository.findById(recordId)
      if (!record) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'KYC record not found')
      }

      if (record.status !== 'pending' && record.status !== 'in_review') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Cannot reject in current state')
      }

      await kycRepository.updateStatus(recordId, 'rejected', undefined, undefined, reason, adminId)

      auditLog('KYC_REJECTED' as AuditEventType, extractAuditContext(req, 'admin'), {
        recordId,
        userId: record.userId,
        reason,
      })

      await emitKycStatusChanged(record.userId, 'rejected')

      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  },
)

export function createKycRouter(): Router {
  return router
}

/**
 * Standalone router for provider-specific KYC webhooks.
 * Mount at /api/webhooks/kyc → handles POST /api/webhooks/kyc/:provider
 */
export function createKycWebhookRouter(): Router {
  const webhookRouter = Router()
  webhookRouter.post('/:provider', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { provider } = req.params
      const rawBody = JSON.stringify(req.body)
      const signature = (req.headers['x-signature'] || req.headers['x-webhook-signature']) as string | undefined

      const secret = process.env[`KYC_WEBHOOK_SECRET_${provider.toUpperCase()}`]
        || process.env.KYC_WEBHOOK_SECRET
        || ''

      if (secret) {
        if (!signature) {
          logger.warn('kyc.provider_webhook_missing_signature', { provider })
          return res.status(401).json({ error: 'Missing signature' })
        }
        const expected = crypto
          .createHmac('sha256', secret)
          .update(rawBody)
          .digest('hex')
        const sigBuf = Buffer.from(signature.replace(/^sha256=/, ''), 'hex')
        const expBuf = Buffer.from(expected, 'hex')
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
          logger.warn('kyc.provider_webhook_invalid_signature', { provider })
          return res.status(401).json({ error: 'Invalid signature' })
        }
      }

      // Respond 200 immediately; process asynchronously
      res.json({ received: true })

      const payload = req.body as Record<string, unknown>
      const id = (payload.id ?? payload.external_id ?? payload.reference) as string | undefined
      const status = payload.status as string | undefined
      const reason = payload.reason as string | undefined

      if (!id || !status) {
        logger.warn('kyc.provider_webhook_missing_fields', { provider, payload })
        return
      }

      const record = await kycRepository.findById(id).catch(() => null)
      if (!record) {
        logger.warn('kyc.provider_webhook_record_not_found', { provider, id })
        return
      }

      const parsed = kycStatusSchema.safeParse(status)
      if (!parsed.success) {
        logger.warn('kyc.provider_webhook_unknown_status', { provider, status })
        return
      }

      await kycRepository.updateStatus(record.id, parsed.data, provider, undefined, reason)
      await emitKycStatusChanged(record.userId, parsed.data)
    } catch (error) {
      logger.error('kyc.provider_webhook_error', { error })
    }
  })
  return webhookRouter
}
