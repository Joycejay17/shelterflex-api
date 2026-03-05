import morgan from "morgan"
import type { IncomingMessage } from "http"

export function createLogger() {
  morgan.token("id", (req: any) => req.requestId)

  return morgan(":id :method :url :status :response-time ms", {
    skip: (req: IncomingMessage) => req.url === "/health",
  })
}