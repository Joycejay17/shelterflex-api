/**
 * PII field registry — used by log masking, response sanitisation, and erasure workflows.
 * NDPA/GDPR: data minimisation requires knowing which fields contain personal data.
 */

export interface PiiFieldEntry {
  model: string
  fields: string[]
}

export const PII_FIELD_REGISTRY: PiiFieldEntry[] = [
  { model: 'User', fields: ['nin', 'bvn', 'bankAccountNumber', 'dateOfBirth', 'phone'] },
  {
    model: 'LandlordProfile',
    fields: ['phone', 'address', 'accountNumber', 'accountName', 'bankName', 'bankAccountNumber'],
  },
  {
    model: 'PersonalInfo',
    fields: ['nin', 'bvn', 'dateOfBirth', 'phone', 'residentialAddress', 'fullName'],
  },
  {
    model: 'EmploymentInfo',
    fields: ['employerName', 'monthlyIncome', 'proofOfEmploymentType'],
  },
  { model: 'SupportMessage', fields: ['name', 'email', 'phone', 'message'] },
  { model: 'Listing', fields: [] },
  { model: 'Withdrawal', fields: ['accountNumber', 'accountName', 'bankName', 'bankAccount'] },
]

/** Flat set of all PII field names (case-insensitive lookup). */
export const ALL_PII_FIELD_NAMES: ReadonlySet<string> = new Set(
  PII_FIELD_REGISTRY.flatMap((entry) => entry.fields.map((f) => f.toLowerCase())),
)

/** Internal pricing fields that must not appear in tenant-facing listing responses. */
export const INTERNAL_LISTING_FIELDS = ['negotiatedLandlordRateNgn'] as const

/** Secret-like keys redacted in logs alongside PII. */
export const SECRET_FIELD_NAMES: ReadonlySet<string> = new Set([
  'password',
  'secret',
  'token',
  'authorization',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'accesstoken',
  'access_token',
  'otp',
  'secretkey',
  'secret_key',
  'masterkey',
  'master_key',
  'mnemonic',
  'passphrase',
])

export function isPiiField(key: string): boolean {
  const lk = key.toLowerCase()
  if (ALL_PII_FIELD_NAMES.has(lk)) return true
  if (SECRET_FIELD_NAMES.has(lk)) return true
  return (
    lk.includes('secret') ||
    lk.includes('password') ||
    lk.includes('token') ||
    lk.includes('private') ||
    lk.includes('credential')
  )
}
