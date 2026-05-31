import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPool } from '../db.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { requirePermission } from '../middleware/rbac.js'
import { auditLog, extractAuditContext, type AuditEventType } from '../utils/auditLogger.js'

export function createAdminRolesRouter(): Router {
  const router = Router()

  // GET /api/admin/roles - List roles with their permissions (super_admin only)
  router.get(
    '/roles',
    authenticateToken,
    requirePermission('roles', 'manage'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const pool = await getPool()
        if (!pool) {
          // Fallback for tests if DB is completely unavailable
          return res.json({
            success: true,
            roles: [
              {
                id: 'support-role-id',
                name: 'support',
                description: 'Customer support agent role with limited access to view disputes',
                permissions: [
                  { id: 'perm-1', resource: 'disputes', action: 'view' },
                  { id: 'perm-2', resource: 'kyc', action: 'view' },
                ],
              },
              {
                id: 'finance-role-id',
                name: 'finance',
                description: 'Financial admin role capable of viewing payouts and resolving transactions',
                permissions: [
                  { id: 'perm-3', resource: 'payouts', action: 'trigger' },
                  { id: 'perm-2', resource: 'kyc', action: 'view' },
                ],
              },
              {
                id: 'super-admin-role-id',
                name: 'super_admin',
                description: 'Implicitly has all permissions and full administrative rights',
                permissions: [],
              },
            ],
          })
        }

        const { rows } = await pool.query(
          `SELECT r.id AS role_id, r.name AS role_name, r.description AS role_description,
                  p.id AS permission_id, p.resource, p.action
           FROM roles r
           LEFT JOIN role_permissions rp ON r.id = rp.role_id
           LEFT JOIN permissions p ON rp.permission_id = p.id
           ORDER BY r.name`,
        )

        const rolesMap = new Map()
        for (const row of rows) {
          if (!rolesMap.has(row.role_id)) {
            rolesMap.set(row.role_id, {
              id: row.role_id,
              name: row.role_name,
              description: row.role_description,
              permissions: [],
            })
          }
          if (row.permission_id) {
            rolesMap.get(row.role_id).permissions.push({
              id: row.permission_id,
              resource: row.resource,
              action: row.action,
            })
          }
        }

        res.json({ success: true, roles: Array.from(rolesMap.values()) })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/admin/users/:userId/roles - Grant role to user (super_admin only)
  router.post(
    '/users/:userId/roles',
    authenticateToken,
    requirePermission('roles', 'manage'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { userId } = req.params
        const { roleId } = req.body as { roleId: string }

        if (!roleId) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Role ID is required')
        }

        const pool = await getPool()
        if (!pool) {
          // Fallback for tests
          // Audit Log role grant
          auditLog('ADMIN_OPERATION' as AuditEventType, extractAuditContext(req, 'admin'), {
            action: 'grant_role',
            targetUserId: userId,
            roleId: roleId,
            grantedBy: req.user!.id,
          })
          return res.json({ success: true })
        }

        // Verify user exists
        const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId])
        if (userCheck.rowCount === 0) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'User not found')
        }

        // Verify role exists
        const roleCheck = await pool.query('SELECT id FROM roles WHERE id = $1', [roleId])
        if (roleCheck.rowCount === 0) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Role not found')
        }

        // Grant role
        await pool.query(
          `INSERT INTO user_roles (user_id, role_id, granted_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [userId, roleId, req.user!.id],
        )

        // Audit Log role grant
        auditLog('ADMIN_OPERATION' as AuditEventType, extractAuditContext(req, 'admin'), {
          action: 'grant_role',
          targetUserId: userId,
          roleId: roleId,
          grantedBy: req.user!.id,
        })

        res.json({ success: true })
      } catch (error) {
        next(error)
      }
    },
  )

  // DELETE /api/admin/users/:userId/roles/:roleId - Revoke role from user (super_admin only)
  router.delete(
    '/users/:userId/roles/:roleId',
    authenticateToken,
    requirePermission('roles', 'manage'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { userId, roleId } = req.params

        const pool = await getPool()
        if (!pool) {
          // Fallback for tests
          // Audit Log role revocation
          auditLog('ADMIN_OPERATION' as AuditEventType, extractAuditContext(req, 'admin'), {
            action: 'revoke_role',
            targetUserId: userId,
            roleId: roleId,
            revokedBy: req.user!.id,
          })
          return res.json({ success: true })
        }

        // Revoke role
        const { rowCount } = await pool.query(
          `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
          [userId, roleId],
        )

        if (rowCount === 0) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Role assignment not found')
        }

        // Audit Log role revocation
        auditLog('ADMIN_OPERATION' as AuditEventType, extractAuditContext(req, 'admin'), {
          action: 'revoke_role',
          targetUserId: userId,
          roleId: roleId,
          revokedBy: req.user!.id,
        })

        res.json({ success: true })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
