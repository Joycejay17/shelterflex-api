import "dotenv/config"
import cors from "cors"
import express from "express"
import morgan from "morgan"
import type { Request, Response } from "express"
import { env } from "./schemas/env.js"
import { errorHandler } from "./middleware/index.js"
import { AppError } from "./errors/index.js"
import { ErrorCode } from "./errors/index.js"
import { randomUUID } from "crypto"

const app = express()

morgan.token("id", (req: Request) => {
  req.headers["x-request-id"] ??= randomUUID()
  return req.headers["x-request-id"] as string
})

if (env.NODE_ENV !== "production") {
  app.use(
    morgan(":id :method :url :status :response-time ms", {
      skip: (req) => req.path === "/health",
    }),
  )
}

app.use(express.json())
app.use(
  cors({
    origin: env.CORS_ORIGINS.split(",").map((s: string) => s.trim()),
  }),
)

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: env.VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
  })
})

app.get("/soroban/config", (_req: Request, res: Response) => {
  res.json({
    rpcUrl: env.SOROBAN_RPC_URL,
    networkPassphrase: env.SOROBAN_NETWORK_PASSPHRASE,
    contractId: env.SOROBAN_CONTRACT_ID ?? null,
  })
})

// 404 catch-all — must be after all routes, before errorHandler
app.use('*', (_req, _res, next) => {
  next(new AppError(ErrorCode.NOT_FOUND, 404, 'Route not found'))
})

// Global error handler — must be last
app.use(errorHandler)

app.listen(env.PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.PORT}`)
})
