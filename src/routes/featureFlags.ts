import { Router } from 'express'
import type { Request, Response } from 'express'
import { getAllFlags } from '../services/featureFlags.js'
import {
  type FlagName,
  GUEST_VISIBLE_FLAGS,
  AUTH_VISIBLE_FLAGS,
} from '../config/featureFlags.js'
import { sessionStore, userStore } from '../models/authStore.js'

/**
 * GET /api/config/feature-flags
 *
 * Returns the flags a caller is allowed to see, based on their auth status:
 *   - Admin: all flags
 *   - Authenticated (any other role): AUTH_VISIBLE_FLAGS
 *   - Guest (no token / invalid token): GUEST_VISIBLE_FLAGS
 *
 * Auth is optional — an invalid or missing token is silently treated as guest.
 */
export function createFeatureFlagsRouter(): Router {
  const router = Router()

  router.get('/', async (req: Request, res: Response) => {
    let role: string | undefined

    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (token) {
      try {
        const session = await sessionStore.getByToken(token)
        if (session) {
          const user = await userStore.getByEmail(session.email)
          role = user?.role
        }
      } catch {
        // Treat invalid/expired token as guest — do not throw.
      }
    }

    const allFlags = getAllFlags()

    const visibleKeys: readonly FlagName[] =
      role === 'admin'
        ? (Object.keys(allFlags) as FlagName[])
        : role
          ? AUTH_VISIBLE_FLAGS
          : GUEST_VISIBLE_FLAGS

    const flags: Partial<Record<FlagName, boolean>> = {}
    for (const key of visibleKeys) {
      flags[key] = allFlags[key]
    }

    res.json({ success: true, data: flags })
  })

  return router
}
