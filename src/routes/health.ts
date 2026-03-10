import { Router, Request, Response } from "express"
import { env } from "../schemas/env.js"

const router = Router()

router.get("/", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    requestId: req.requestId,
  })
})

router.get("/details", (req: Request, res: Response) => {
  const sorobanAdapterMode = (process.env.SOROBAN_ADAPTER_MODE ?? 'stub') === 'real'
    ? 'real'
    : 'stub'

  res.json({
    version: env.VERSION,
    nodeEnv: env.NODE_ENV,
    sorobanAdapterMode,
    databaseEnabled: !!process.env.DATABASE_URL,
    requestId: req.requestId,
  })
})

export default router