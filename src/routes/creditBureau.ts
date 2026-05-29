/**
 * Credit Bureau Routes
 * API endpoints for credit report management
 */

import { Router, Request, Response } from "express";
import { creditBureauService } from "../services/creditBureauService.js";
import { auditLog } from "../repositories/AuditRepository.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { logger } from "../utils/logger.js";

const router = Router();

/**
 * POST /api/admin/tenants/:tenantId/pull-credit-report
 * Admin-triggered credit report pull
 */
router.post(
  "/admin/tenants/:tenantId/pull-credit-report",
  async (req: Request, res: Response, next) => {
    try {
      const { tenantId } = req.params;
      const { bvn, nin } = req.body;

      // Validation
      if (!bvn || !nin) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          "BVN and NIN are required",
        );
      }

      if (!/^\d{11}$/.test(bvn)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          "Invalid BVN format",
        );
      }

      if (!/^\d{11}$/.test(nin)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          "Invalid NIN format",
        );
      }

      // Pull report
      const report = await creditBureauService.pullReport(tenantId, bvn, nin);

      // Audit log (without logging BVN/NIN in plain text)
      const adminId = (req as any).user?.id || "unknown";
      await auditLog({
        actor: adminId,
        action: "CREDIT_REPORT_PULLED",
        resourceType: "tenant",
        resourceId: tenantId,
        details: {
          provider: process.env.CREDIT_BUREAU_PROVIDER || "mock",
          score: report.score,
        },
      });

      res.json({
        success: true,
        report,
        pulledAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/admin/tenants/:tenantId/credit-report
 * View latest cached credit report
 */
router.get(
  "/admin/tenants/:tenantId/credit-report",
  async (req: Request, res: Response, next) => {
    try {
      const { tenantId } = req.params;

      const report = await creditBureauService.getCachedReport(tenantId);

      if (!report) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          404,
          "No cached credit report found for this tenant",
        );
      }

      // Audit log
      const adminId = (req as any).user?.id || "unknown";
      await auditLog({
        actor: adminId,
        action: "CREDIT_REPORT_VIEWED",
        resourceType: "tenant",
        resourceId: tenantId,
        details: { score: report.score },
      });

      res.json({
        success: true,
        report,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
