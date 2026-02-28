import { Router, Request, Response } from "express"

const router = Router()

router.get("/", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    requestId: req.requestId,
  })
})

export default router