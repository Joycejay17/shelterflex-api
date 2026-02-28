import { Router, Request, Response } from "express"
import { env } from "../schemas/env.js"
import { validate } from "../middleware/validate.js"
import { echoRequestSchema, type EchoResponse } from "../schemas/echo.js"

const publicRouter = Router()

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

export default publicRouter