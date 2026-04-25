import { z } from 'zod'
import { PropertyStatus } from '../models/landlordProperty.js'

export const createPropertySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().optional(),
  area: z.string().optional(),
  bedrooms: z.number().int().min(0, 'Bedrooms must be 0 or greater'),
  bathrooms: z.number().int().min(0, 'Bathrooms must be 0 or greater'),
  sqm: z.number().positive().optional(),
  annualRentNgn: z.number().positive('Annual rent must be greater than 0'),
  description: z.string().optional(),
  photos: z.array(z.string().url()).min(1, 'At least one photo is required'),
})

export const updatePropertySchema = z.object({
  title: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  sqm: z.number().positive().optional(),
  annualRentNgn: z.number().positive().optional(),
  description: z.string().optional(),
  photos: z.array(z.string().url()).min(1).optional(),
  status: z.nativeEnum(PropertyStatus).optional(),
})

export const propertyFiltersSchema = z.object({
  status: z.nativeEnum(PropertyStatus).optional(),
  query: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
