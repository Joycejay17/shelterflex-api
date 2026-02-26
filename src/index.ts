import "dotenv/config"
import cors from "cors"
import express from "express"
import morgan from "morgan"
import { z } from "zod"
import { randomUUID } from "crypto"
import type { Request, Response } from "express"
import { createRequire } from "module"



const require = createRequire(import.meta.url)
const { version } = require("../package.json")

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.string().default("development"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  SOROBAN_RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org"),
  SOROBAN_NETWORK_PASSPHRASE: z.string().default("Test SDF Network ; September 2015"),
  SOROBAN_CONTRACT_ID: z.string().optional(),
})

const env = envSchema.parse(process.env)

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
    version,
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

app.listen(env.PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.PORT}`)
})
