import { ZodError } from 'zod'
import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode, type ErrorResponse } from '../errors/errorCodes.js'
import { formatZodIssues } from '../errors/utils.js'

/**
 * Global Express error-handling middleware.
 * Must be registered AFTER all routes: `app.use(errorHandler)`
 *
 * Handled cases:
 *  - `AppError`   → controlled domain error, uses its own metadata
 *  - `ZodError`   → schema.parse() thrown inside a route handler → 400
 *  - `SyntaxError` with `body` → malformed JSON body → 400
 *  - Unknown      → safe 500, never leaks internals
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // AppError controlled domain error
  if (err instanceof AppError) {
    const body: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    }
    res.status(err.status).json(body)
    return
  }

  // ZodError schema.parse() thrown directly inside a route handler
  if (err instanceof ZodError) {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid request data',
        details: formatZodIssues(err.issues),
      },
    }
    res.status(400).json(body)
    return
  }

  // SyntaxError malformed JSON body (thrown by express.json())
  if (err instanceof SyntaxError && 'body' in err) {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Malformed JSON in request body',
      },
    }
    res.status(400).json(body)
    return
  }

  // Unknown never leak internals to the client
  console.error('[errorHandler] Unhandled error:', err)
  const body: ErrorResponse = {
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
    },
  }
  res.status(500).json(body)
}
