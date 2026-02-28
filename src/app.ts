import express from "express"
import cors from "cors"
import { env } from "./schemas/env.js"
import { requestIdMiddleware } from "./middleware/requestId.js"
import { errorHandler } from "./middleware/errorHandler.js"
import { createLogger } from "./middleware/logger.js"
import healthRouter from "./routes/health.js"
import { createPublicRateLimiter } from "./middleware/rateLimit.js"
import publicRouter from "./routes/publicRoutes.js"
import { AppError } from "./errors/AppError.js"
import { ErrorCode } from "./errors/errorCodes.js"

export function createApp() {
  const app = express()

  // Core middleware
  app.use(requestIdMiddleware)

  if (env.NODE_ENV !== "production") {
    app.use(createLogger())
  }

  app.use(express.json())

  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(",").map((s: string) => s.trim()),
    }),
  )

  // Routes
  app.use("/health", healthRouter)
  app.use(createPublicRateLimiter(env))
  app.use("/", publicRouter)



  // 404 catch-all — must be after all routes, before errorHandler
  app.use('*', (_req, _res, next) => {
    next(new AppError(ErrorCode.NOT_FOUND, 404, `Route ${_req.originalUrl} not found`))
  })


  // Error handler (must be last)
  app.use(errorHandler)

  return app
}