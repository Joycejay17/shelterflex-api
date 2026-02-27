import { Request, Response, NextFunction } from "express"

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error({
    requestId: req.requestId,
    message: err?.message,
    stack: err?.stack,
  })

  res
    .status(err?.status ?? 500)
    .setHeader("x-request-id", req.requestId)
    .json({
      success: false,
      message: err?.message ?? "Internal Server Error",
      requestId: req.requestId,
    })
}