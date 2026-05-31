/**
 * Shared property amenities (issue #894).
 * Keep in sync with frontend/lib/amenities.ts
 */

export const PROPERTY_AMENITIES = [
  'parking',
  'generator',
  'water_heater',
  'security',
  'gym',
  'swimming_pool',
  'cctv',
  'elevator',
  'furnished',
  'serviced',
] as const

export type PropertyAmenity = (typeof PROPERTY_AMENITIES)[number]

export const PROPERTY_AMENITY_LABELS: Record<PropertyAmenity, string> = {
  parking: 'Parking',
  generator: 'Generator',
  water_heater: 'Water Heater',
  security: 'Security',
  gym: 'Gym',
  swimming_pool: 'Swimming Pool',
  cctv: 'CCTV',
  elevator: 'Elevator',
  furnished: 'Furnished',
  serviced: 'Serviced',
}

export const PROPERTY_TYPES = ['flat', 'duplex', 'studio', 'room'] as const
export type PropertyType = (typeof PROPERTY_TYPES)[number]
