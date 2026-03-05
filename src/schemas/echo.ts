import { z } from 'zod'

/**
 * Example schema for the /api/example/echo endpoint.
 * Demonstrates Zod validation patterns for contributors.
 */
export const echoRequestSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(100, 'Message too long'),
  timestamp: z.number().int().positive().optional(),
})

export type EchoRequest = z.infer<typeof echoRequestSchema>

export const echoResponseSchema = z.object({
  echo: z.string(),
  receivedAt: z.string(),
  originalTimestamp: z.number().optional(),
})

export type EchoResponse = z.infer<typeof echoResponseSchema>
