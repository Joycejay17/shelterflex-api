import "dotenv/config"
import cors from "cors"
import express from "express"
import morgan from "morgan"
import type { Request, Response } from "express"
import { env } from "./schemas/env.js"

const app = express()

app.use(morgan("dev"))
app.use(express.json())
app.use(
  cors({
    origin: env.CORS_ORIGINS.split(",").map((s: string) => s.trim()),
  }),
)

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "shelterflex-backend",
    env: env.NODE_ENV,
  })
})

app.get("/soroban/config", (_req: Request, res: Response) => {
  res.json({
    rpcUrl: env.SOROBAN_RPC_URL,
    networkPassphrase: env.SOROBAN_NETWORK_PASSPHRASE,
    contractId: env.SOROBAN_CONTRACT_ID ?? null,
  })
})

app.listen(env.PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.PORT}`)
})
