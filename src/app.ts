import express from "express"
import cors from "cors"
import { env } from "./schemas/env.js"

import { requestIdMiddleware } from "./middleware/requestId.js"
import { errorHandler } from "./middleware/errorHandler.js"
import { createLogger } from "./middleware/logger.js"
import healthRouter from "./routes/health.js"

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

  // Error handler (must be last)
  app.use(errorHandler)

  return app
}