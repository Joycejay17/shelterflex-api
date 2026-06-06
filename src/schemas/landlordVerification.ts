import { z } from 'zod'

export const verificationLevel = z.enum(['unverified', 'id_verified', 'id_and_property_verified', 'premium'])

export const landlordVerificationSchema = z.object({
  verificationLevel: verificationLevel,
  verifiedAt: z.string().optional().nullable(),
  verifiedBy: z.string().optional(),
  note: z.string().min(1),
})

export type LandlordVerification = z.infer<typeof landlordVerificationSchema>
