import { Router } from 'express'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'
import { inspectorService } from '../services/inspectorService.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { auditLog, extractAuditContext } from '../utils/auditLogger.js'

function assertInspector(req: AuthenticatedRequest) {
  if (req.user?.role !== 'inspector' && req.user?.role !== 'admin') {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only inspectors can access this resource')
  }
}

function assertAdmin(req: AuthenticatedRequest) {
  if (req.user?.role !== 'admin') {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only admins can access this resource')
  }
}

// Inspector-facing router — mounted at /api/inspector
export function createInspectorJobsRouter(): Router {
  const router = Router()

  router.get('/jobs', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      assertInspector(req)
      const jobs = await inspectorService.listAvailableJobs()
      res.json({ success: true, data: jobs })
    } catch (error) {
      next(error)
    }
  })

  router.post('/jobs/:id/claim', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      assertInspector(req)
      const job = await inspectorService.claimJob(req.params.id, req.user!.id)
      auditLog('INSPECTOR_JOB_CLAIMED' as any, extractAuditContext(req, 'user'), {
        jobId: job.id,
        listingId: job.listingId,
      })
      res.json({ success: true, data: job })
    } catch (error) {
      next(error)
    }
  })

  router.post('/jobs/:id/report', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      assertInspector(req)
      const { job, report } = await inspectorService.submitReport(
        req.params.id,
        req.user!.id,
        req.body,
      )
      auditLog('INSPECTOR_REPORT_SUBMITTED' as any, extractAuditContext(req, 'user'), {
        jobId: job.id,
        reportId: report.id,
        grade: report.overallGrade,
      })
      res.status(201).json({ success: true, data: { job, report } })
    } catch (error) {
      next(error)
    }
  })

  return router
}

// Admin-facing router — mounted at /api/admin/inspector
export function createAdminInspectorJobsRouter(): Router {
  const router = Router()

  router.get('/jobs', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      assertAdmin(req)
      const jobs = await inspectorService.listAllJobs()
      res.json({ success: true, data: jobs })
    } catch (error) {
      next(error)
    }
  })

  router.post('/jobs', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      assertAdmin(req)
      const { listingId, offeredFeeNgn } = req.body
      if (!listingId || !offeredFeeNgn) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'listingId and offeredFeeNgn are required')
      }
      const job = await inspectorService.createJob(listingId, offeredFeeNgn)
      auditLog('INSPECTOR_JOB_CREATED' as any, extractAuditContext(req, 'admin'), {
        jobId: job.id,
        listingId,
        offeredFeeNgn,
      })
      res.status(201).json({ success: true, data: job })
    } catch (error) {
      next(error)
    }
  })

  router.post('/jobs/:id/approve', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      assertAdmin(req)
      const job = await inspectorService.approveReport(req.params.id)
      auditLog('INSPECTOR_REPORT_APPROVED' as any, extractAuditContext(req, 'admin'), {
        jobId: job.id,
        listingId: job.listingId,
        inspectorId: job.inspectorId,
      })
      res.json({ success: true, data: job })
    } catch (error) {
      next(error)
    }
  })

  router.post('/jobs/:id/reject', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      assertAdmin(req)
      const { reason } = req.body
      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Rejection reason is required')
      }
      const job = await inspectorService.rejectReport(req.params.id, reason)
      auditLog('INSPECTOR_REPORT_REJECTED' as any, extractAuditContext(req, 'admin'), {
        jobId: job.id,
        reason,
      })
      res.json({ success: true, data: job })
    } catch (error) {
      next(error)
    }
  })

  return router
}
