import { Router, type Response, type NextFunction } from 'express'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { NgnWalletService } from '../services/ngnWalletService.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import { riskStateResponseSchema } from '../schemas/risk.js'

export function createRiskRouter(ngnWalletService: NgnWalletService): Router {
  const router = Router()

  router.get(
    '/state',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user!.id

        const [riskState, balance] = await Promise.all([
          userRiskStateStore.getByUserId(userId),
          ngnWalletService.getBalance(userId),
        ])

        const negativeBalanceFrozen = balance.totalNgn < 0
        const isFrozen = Boolean(riskState?.isFrozen || negativeBalanceFrozen)

        const freezeReason = isFrozen
          ? (riskState?.freezeReason ?? (negativeBalanceFrozen ? 'NEGATIVE_BALANCE' : null))
          : null

        const deficitNgn = isFrozen && negativeBalanceFrozen ? Math.abs(balance.totalNgn) : 0

        const response = {
          isFrozen,
          freezeReason,
          deficitNgn,
          updatedAt: (riskState?.updatedAt ?? new Date()).toISOString(),
        }

        res.json(riskStateResponseSchema.parse(response))
      } catch (error) {
        next(error)
      }
    }
  )

  return router
}
