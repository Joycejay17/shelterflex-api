import { z } from 'zod'
import { ListingStatus } from '../models/listing.js'

/**
 * Schema for creating a new listing
 */
export const createListingSchema = z.object({
  whistleblowerId: z.string().min(1, 'Whistleblower ID is required'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().optional(),
  area: z.string().optional(),
  bedrooms: z.number().int().min(0, 'Bedrooms must be 0 or greater'),
  bathrooms: z.number().int().min(0, 'Bathrooms must be 0 or greater'),
  annualRentNgn: z
    .number()
    .positive('Annual rent must be greater than 0')
    .int('Annual rent must be a whole number'),
  negotiatedLandlordRateNgn: z.number().positive().int().optional(),
  outrightPriceNgn: z.number().positive().int().optional(),
  installmentBasePriceNgn: z.number().positive().int().optional(),
  description: z.string().optional(),
  photos: z
    .array(z.string().url('Each photo must be a valid URL'))
    .min(3, 'At least 3 photos are required')
    .max(20, 'Maximum 20 photos allowed'),
})

export type CreateListingRequest = z.infer<typeof createListingSchema>

/**
 * Schema for listing filters (query params)
 */
export const listingFiltersSchema = z.object({
  status: z.nativeEnum(ListingStatus).optional(),
  query: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type ListingFiltersRequest = z.infer<typeof listingFiltersSchema>

/**
 * Schema for property search filters (public-facing)
 */
export const propertySearchSchema = z.object({
  city: z.string().optional(),
  area: z.string().optional(),
  minBedrooms: z.coerce.number().int().min(0).optional(),
  maxBedrooms: z.coerce.number().int().min(0).optional(),
  minBathrooms: z.coerce.number().int().min(0).optional(),
  maxBathrooms: z.coerce.number().int().min(0).optional(),
  minAnnualRent: z.coerce.number().int().min(0).optional(),
  maxAnnualRent: z.coerce.number().int().min(0).optional(),
  query: z.string().optional(),
  sortBy: z.enum(['price_asc', 'price_desc', 'newest', 'bedrooms_desc']).optional().default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type PropertySearchRequest = z.infer<typeof propertySearchSchema>

/**
 * Query params for GET /api/admin/whistleblower/listings
 * Defaults to pending_review so the moderation queue is immediately visible
 */
export const adminListingFiltersSchema = z.object({
  status: z.nativeEnum(ListingStatus).optional().default(ListingStatus.PENDING_REVIEW),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type AdminListingFiltersRequest = z.infer<typeof adminListingFiltersSchema>

/**
 * Body for POST /api/admin/whistleblower/listings/:id/approve
 */
export const approveListingSchema = z.object({
  reviewedBy: z.string().min(1, 'Reviewer ID is required'),
})

export type ApproveListingRequest = z.infer<typeof approveListingSchema>

/**
 * Body for POST /api/admin/whistleblower/listings/:id/reject
 */
export const rejectListingSchema = z.object({
  reviewedBy: z.string().min(1, 'Reviewer ID is required'),
  reason: z.string().min(1, 'Rejection reason is required'),
})

export type RejectListingRequest = z.infer<typeof rejectListingSchema>
