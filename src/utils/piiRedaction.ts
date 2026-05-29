import { isPiiField } from '../config/piiFields.js'

const REDACTED = '[REDACTED]'

/**
 * Recursively redact PII and secret field values in log/audit payloads.
 */
export function redactPiiFields(value: unknown, depth = 0): unknown {
  if (depth > 20) return REDACTED
  if (value === null || value === undefined) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactPiiFields(item, depth + 1))
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isPiiField(key)) {
        result[key] = REDACTED
      } else if (val !== null && typeof val === 'object') {
        result[key] = redactPiiFields(val, depth + 1)
      } else {
        result[key] = val
      }
    }
    return result
  }
  return value
}
