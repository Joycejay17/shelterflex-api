import { z } from 'zod'
import { PropertyStatus } from '../models/landlordProperty.js'
import {
  PROPERTY_AMENITIES,
  PROPERTY_TYPES,
} from './amenities.js'
import {
  validatePricingConfig,
  PricingValidationError,
  MIN_OUTRIGHT_MARGIN_PERCENT,
} from '../services/pricingService.js'

const amenitySchema = z.enum(PROPERTY_AMENITIES)
const propertyTypeSchema = z.enum(PROPERTY_TYPES)

const PROPERTY_TYPE_ALIASES: Record<string, (typeof PROPERTY_TYPES)[number]> = {
  apartment: 'flat',
  bungalow: 'duplex',
  terrace: 'duplex',
  penthouse: 'duplex',
}

const pricingFieldsSchema = z.object({
  negotiatedLandlordRateNgn: z.number().positive().optional(),
  outrightPriceNgn: z.number().positive().optional(),
  installmentBasePriceNgn: z.number().positive().optional(),
})

function applyPricingValidation(
  val: z.infer<typeof pricingFieldsSchema> & {
    negotiatedLandlordRateNgn?: number
    outrightPriceNgn?: number
    installmentBasePriceNgn?: number
    price?: string | number
    annualRentNgn?: number
  },
  ctx: z.RefinementCtx,
) {
  const negotiated =
    val.negotiatedLandlordRateNgn ??
    (val.price !== undefined ? Number(val.price) : undefined)
  const outright = val.outrightPriceNgn
  const installment =
    val.installmentBasePriceNgn ?? val.annualRentNgn ?? negotiated

  if (negotiated === undefined || outright === undefined || installment === undefined) {
    return
  }

  if (Number.isNaN(negotiated) || Number.isNaN(outright) || Number.isNaN(installment)) {
    return
  }

  try {
    validatePricingConfig(negotiated, outright, installment)
  } catch (error) {
    if (error instanceof PricingValidationError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error.message,
        path: ['outrightPriceNgn'],
      })
    } else {
      throw error
    }
  }
}

function parsePhotos(
  photos?: string[],
  images?: Array<{ id: string; roomType?: string; preview: string }>,
): string[] {
  if (photos && photos.length > 0) {
    return photos
  }
  if (images && images.length > 0) {
    return images.map((img) => img.preview).filter(Boolean)
  }
  return []
}

const basePropertyFields = {
  title: z.string().trim().min(1, 'Title is required'),
  address: z.string().trim().min(1, 'Address is required'),
  city: z.string().trim().optional(),
  area: z.string().trim().optional(),
  propertyType: z.string().trim().optional(),
  propertyTypeWizard: z.string().trim().optional(),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  sqm: z.union([z.number(), z.string()]).optional(),
  annualRentNgn: z.number().positive().optional(),
  description: z.string().optional(),
  photos: z.array(z.string()).optional(),
  amenities: z.array(amenitySchema).optional(),
  primaryPhotoIndex: z.number().int().min(0).optional(),
  videoUrl: z.string().url().optional().or(z.literal('')),
  negotiatedLandlordRateNgn: z.number().positive().optional(),
  outrightPriceNgn: z.number().positive().optional(),
  installmentBasePriceNgn: z.number().positive().optional(),
  location: z.string().trim().optional(),
  price: z.union([z.string(), z.number()]).optional(),
  beds: z.union([z.string(), z.number()]).optional(),
  baths: z.union([z.string(), z.number()]).optional(),
  yearBuilt: z.union([z.string(), z.number()]).optional(),
  images: z
    .array(
      z.object({
        id: z.string(),
        roomType: z.string().optional(),
        preview: z.string(),
      }),
    )
    .optional(),
  photoOrder: z.array(z.string()).optional(),
}

export const createPropertySchema = z
  .object(basePropertyFields)
  .superRefine((val, ctx) => {
    const bedrooms = val.bedrooms ?? (val.beds !== undefined ? Number(val.beds) : undefined)
    const bathrooms = val.bathrooms ?? (val.baths !== undefined ? Number(val.baths) : undefined)

    if (bedrooms === undefined || Number.isNaN(bedrooms)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bedrooms is required', path: ['bedrooms'] })
    }
    if (bathrooms === undefined || Number.isNaN(bathrooms)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bathrooms is required', path: ['bathrooms'] })
    }

    const photos = parsePhotos(val.photos, val.images)
    if (photos.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least 3 photos are required',
        path: ['photos'],
      })
    }
    if (photos.length > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Maximum 20 photos allowed',
        path: ['photos'],
      })
    }

    applyPricingValidation(val, ctx)
  })
  .transform((val) => {
    const bedrooms = val.bedrooms ?? Number(val.beds)
    const bathrooms = val.bathrooms ?? Number(val.baths)
    const negotiated = val.negotiatedLandlordRateNgn ?? Number(val.price)
    const installmentBase = val.installmentBasePriceNgn ?? negotiated
    const outright = val.outrightPriceNgn ?? negotiated
    const photos = parsePhotos(val.photos, val.images)
    const orderedPhotos = val.photoOrder?.length
      ? val.photoOrder.filter((url) => photos.includes(url))
      : photos

    let primaryPhotoIndex = val.primaryPhotoIndex ?? 0
    if (orderedPhotos.length > 0) {
      primaryPhotoIndex = Math.min(primaryPhotoIndex, orderedPhotos.length - 1)
    }

    return {
      title: val.title,
      address: val.address,
      city: val.city,
      area: val.area ?? val.location,
      propertyType: (() => {
        const raw = val.propertyType ?? val.propertyTypeWizard
        if (!raw) return undefined
        if (PROPERTY_TYPES.includes(raw as (typeof PROPERTY_TYPES)[number])) {
          return raw as (typeof PROPERTY_TYPES)[number]
        }
        return PROPERTY_TYPE_ALIASES[raw]
      })(),
      bedrooms,
      bathrooms,
      sqm: val.sqm === undefined ? undefined : Number(val.sqm),
      annualRentNgn: installmentBase,
      negotiatedLandlordRateNgn: negotiated,
      outrightPriceNgn: outright,
      installmentBasePriceNgn: installmentBase,
      description: val.description,
      amenities: val.amenities ?? [],
      photos: orderedPhotos,
      primaryPhotoIndex,
      videoUrl: val.videoUrl || undefined,
    }
  })

export const updatePropertySchema = z
  .object({
    ...basePropertyFields,
    title: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    status: z.nativeEnum(PropertyStatus).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.photos !== undefined || val.images !== undefined) {
      const photos = parsePhotos(val.photos, val.images)
      if (photos.length > 0 && photos.length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'At least 3 photos are required',
          path: ['photos'],
        })
      }
      if (photos.length > 20) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Maximum 20 photos allowed',
          path: ['photos'],
        })
      }
    }
    applyPricingValidation(val, ctx)
  })
  .transform((val) => {
    const result: Record<string, unknown> = {}
    if (val.title !== undefined) result.title = val.title
    if (val.address !== undefined) result.address = val.address
    if (val.city !== undefined) result.city = val.city
    if (val.area !== undefined || val.location !== undefined) {
      result.area = val.area ?? val.location
    }
    if (val.propertyType !== undefined || val.propertyTypeWizard !== undefined) {
      result.propertyType = val.propertyType ?? val.propertyTypeWizard
    }
    if (val.bedrooms !== undefined || val.beds !== undefined) {
      result.bedrooms = val.bedrooms ?? Number(val.beds)
    }
    if (val.bathrooms !== undefined || val.baths !== undefined) {
      result.bathrooms = val.bathrooms ?? Number(val.baths)
    }
    if (val.sqm !== undefined) result.sqm = Number(val.sqm)
    if (val.description !== undefined) result.description = val.description
    if (val.amenities !== undefined) result.amenities = val.amenities
    if (val.videoUrl !== undefined) result.videoUrl = val.videoUrl || undefined
    if (val.primaryPhotoIndex !== undefined) result.primaryPhotoIndex = val.primaryPhotoIndex
    if (val.negotiatedLandlordRateNgn !== undefined) {
      result.negotiatedLandlordRateNgn = val.negotiatedLandlordRateNgn
    } else if (val.price !== undefined) {
      result.negotiatedLandlordRateNgn = Number(val.price)
    }
    if (val.outrightPriceNgn !== undefined) result.outrightPriceNgn = val.outrightPriceNgn
    if (val.installmentBasePriceNgn !== undefined) {
      result.installmentBasePriceNgn = val.installmentBasePriceNgn
    }
    if (val.annualRentNgn !== undefined) result.annualRentNgn = val.annualRentNgn
    if (val.photos !== undefined || val.images !== undefined) {
      const photos = parsePhotos(val.photos, val.images)
      result.photos = val.photoOrder?.length
        ? val.photoOrder.filter((url) => photos.includes(url))
        : photos
    }
    if (val.status !== undefined) result.status = val.status
    return result
  })

export const propertyFiltersSchema = z.object({
  status: z.nativeEnum(PropertyStatus).optional(),
  query: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export { MIN_OUTRIGHT_MARGIN_PERCENT }
