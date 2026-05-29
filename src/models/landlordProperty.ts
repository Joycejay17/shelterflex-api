/**
 * Landlord Property model and types
 */

import type { PropertyAmenity, PropertyType } from '../schemas/amenities.js'

export enum PropertyStatus {
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  RENTED = 'rented',
  DEACTIVATED = 'deactivated',
  /** @deprecated use PENDING_REVIEW */
  PENDING = 'pending',
  /** @deprecated use APPROVED */
  ACTIVE = 'active',
  /** @deprecated use DEACTIVATED */
  INACTIVE = 'inactive',
}

export function normalizePropertyStatus(status: string): PropertyStatus {
  switch (status) {
    case PropertyStatus.PENDING_REVIEW:
    case PropertyStatus.APPROVED:
    case PropertyStatus.RENTED:
    case PropertyStatus.DEACTIVATED:
      return status as PropertyStatus
    case 'pending':
      return PropertyStatus.PENDING_REVIEW
    case 'active':
      return PropertyStatus.APPROVED
    case 'inactive':
      return PropertyStatus.DEACTIVATED
    default:
      return PropertyStatus.PENDING_REVIEW
  }
}

export interface LandlordProperty {
  id: string
  landlordId: string
  title: string
  address: string
  city?: string
  area?: string
  propertyType?: PropertyType
  bedrooms: number
  bathrooms: number
  sqm?: number
  annualRentNgn: number
  negotiatedLandlordRateNgn?: number
  outrightPriceNgn?: number
  installmentBasePriceNgn?: number
  description?: string
  amenities: PropertyAmenity[]
  photos: string[]
  primaryPhotoIndex: number
  videoUrl?: string
  listingId?: string
  status: PropertyStatus
  views: number
  inquiries: number
  createdAt: Date
  updatedAt: Date
}

export interface CreatePropertyInput {
  landlordId: string
  title: string
  address: string
  city?: string
  area?: string
  propertyType?: PropertyType
  bedrooms: number
  bathrooms: number
  sqm?: number
  annualRentNgn: number
  negotiatedLandlordRateNgn?: number
  outrightPriceNgn?: number
  installmentBasePriceNgn?: number
  description?: string
  amenities?: PropertyAmenity[]
  photos: string[]
  primaryPhotoIndex?: number
  videoUrl?: string
}

export interface UpdatePropertyInput {
  title?: string
  address?: string
  city?: string
  area?: string
  propertyType?: PropertyType
  bedrooms?: number
  bathrooms?: number
  sqm?: number
  annualRentNgn?: number
  negotiatedLandlordRateNgn?: number
  outrightPriceNgn?: number
  installmentBasePriceNgn?: number
  description?: string
  amenities?: PropertyAmenity[]
  photos?: string[]
  primaryPhotoIndex?: number
  videoUrl?: string
  listingId?: string
  status?: PropertyStatus
}

export interface PropertyFilters {
  landlordId?: string
  status?: PropertyStatus
  query?: string
  page?: number
  pageSize?: number
}

export interface PaginatedProperties {
  properties: LandlordProperty[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
