import { Router, Request, Response } from "express"
import { env } from "../schemas/env.js"

const publicRouter = Router()

publicRouter.get("/soroban/config", (_req: Request, res: Response) => {
    res.json({
        rpcUrl: env.SOROBAN_RPC_URL,
        networkPassphrase: env.SOROBAN_NETWORK_PASSPHRASE,
        contractId: env.SOROBAN_CONTRACT_ID ?? null,
    })
})

export default publicRouter