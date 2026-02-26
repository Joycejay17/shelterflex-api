import "dotenv/config"
import cors from "cors"
import express from "express"
import morgan from "morgan"
import { z } from "zod"
import type { Request, Response } from "express"
import { validate } from "./middleware/validate.js"
import { simulateContractSchema, type SimulateContractInput } from "./schemas/soroban.js"

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

/**
 * POST /soroban/simulate
 *
 * Validates the request body with Zod before forwarding to the Soroban RPC.
 * Returns 400 with structured field-level errors on invalid input.
 *
 * Body: { contractId: string, method: string, args?: unknown[] }
 */
app.post(
  "/soroban/simulate",
  validate(simulateContractSchema),
  (req: Request, res: Response) => {
    const { contractId, method, args } = req.body as SimulateContractInput

    // TODO: replace stub with actual SorobanRpc.Server#simulateTransaction call
    res.json({
      contractId,
      method,
      args,
      status: "pending",
      message: "Simulation queued – RPC integration coming soon",
    })
  },
)

app.listen(env.PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.PORT}`)
})
