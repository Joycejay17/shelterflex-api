import { ZodSchema } from 'zod'
import { Request, Response, NextFunction } from 'express'

type ValidateTarget = 'body' | 'query' | 'params'

export const validate =
  (schema: ZodSchema, target: ValidateTarget = 'body') =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target])

    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map(issue => ({
          field: issue.path.join('.') || target,
          message: issue.message,
        })),
      })
    }

    // Assign the coerced/defaulted data back so handlers see clean types
    ;(req as unknown as Record<string, unknown>)[target] = result.data
    next()
  }