import { PII_FIELD_REGISTRY, INTERNAL_LISTING_FIELDS } from '../config/piiFields.js'

type PlainObject = Record<string, unknown>

function isPlainObject(value: unknown): value is PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fieldsForModel(model: string): ReadonlySet<string> {
  const entry = PII_FIELD_REGISTRY.find((e) => e.model === model)
  return new Set(entry?.fields.map((f) => f.toLowerCase()) ?? [])
}

/**
 * Strip PII fields from an object before serialising to tenant-facing responses.
 * Uses model-specific field lists so e.g. User.email is kept while SupportMessage.email is stripped.
 */
export function sanitiseForClient<T extends PlainObject>(
  obj: T,
  model = 'User',
): PlainObject {
  if (!isPlainObject(obj)) return obj
  const stripFields = fieldsForModel(model)
  const result: PlainObject = {}
  for (const [key, value] of Object.entries(obj)) {
    if (stripFields.has(key.toLowerCase())) continue
    if (isPlainObject(value)) {
      result[key] = sanitiseForClient(value, model)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => (isPlainObject(item) ? sanitiseForClient(item, model) : item))
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Remove internal pricing fields from listing objects returned to tenants.
 */
export function sanitiseListingForClient<T extends PlainObject>(listing: T): PlainObject {
  const result = sanitiseForClient(listing, 'Listing')
  for (const field of INTERNAL_LISTING_FIELDS) {
    delete result[field]
  }
  return result
}

/**
 * Strip encrypted/raw PII from onboarding personal info in any response path.
 */
export function sanitisePersonalInfo(info: PlainObject | null | undefined): PlainObject | null {
  if (!info) return null
  return sanitiseForClient(info, 'PersonalInfo')
}
