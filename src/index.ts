import "dotenv/config"
import { createApp } from "./app.js"
import { env } from "./schemas/env.js"
import { errorHandler, validate } from "./middleware/index.js"
import { AppError } from "./errors/index.js"
import { ErrorCode } from "./errors/index.js"
import { echoRequestSchema, type EchoResponse } from "./schemas/echo.js"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const { version } = require("../package.json") as { version: string }

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

// Public routes: rate limited
const publicRouter = express.Router()
publicRouter.use(createPublicRateLimiter(env))
publicRouter.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: env.VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
  })
})
publicRouter.get("/soroban/config", (_req: Request, res: Response) => {
  res.json({
    rpcUrl: env.SOROBAN_RPC_URL,
    networkPassphrase: env.SOROBAN_NETWORK_PASSPHRASE,
    contractId: env.SOROBAN_CONTRACT_ID ?? null,
  })
})

// Example endpoint demonstrating Zod validation
publicRouter.post(
  "/api/example/echo",
  validate(echoRequestSchema, "body"),
  (req: Request, res: Response) => {
    const { message, timestamp } = req.body
    const response: EchoResponse = {
      echo: message,
      receivedAt: new Date().toISOString(),
      ...(timestamp ? { originalTimestamp: timestamp } : {}),
    }
    res.json(response)
  },
)

app.use("/", publicRouter)

// 404 catch-all — must be after all routes, before errorHandler
app.use('*', (_req, _res, next) => {
  next(new AppError(ErrorCode.NOT_FOUND, 404, 'Route not found'))
})

// Global error handler — must be last
app.use(errorHandler)
const app = createApp()

app.listen(env.PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.PORT}`)
})