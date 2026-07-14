/**
 * Seeds whistleblower_listings with the sample properties already bundled in
 * shelterflex-web (lib/mockData/properties.ts + public/properties/<id>/*.jpg)
 * so the public /properties search page has data to show in local dev.
 *
 * Usage: npx tsx src/scripts/seedSampleProperties.ts
 */
import "dotenv/config";
import { getPool } from "../db.js";

interface SampleProperty {
  address: string;
  city: string;
  area: string;
  bedrooms: number;
  bathrooms: number;
  annualRentNgn: number;
  outrightPriceNgn: number;
  installmentBasePriceNgn: number;
  description: string;
  photos: string[];
}

const SAMPLE_PROPERTIES: SampleProperty[] = [
  {
    address: "15 Admiralty Way, Lekki Phase 1, Lagos",
    city: "Lagos",
    area: "Lekki Phase 1",
    bedrooms: 3,
    bathrooms: 3,
    annualRentNgn: 3_500_000,
    outrightPriceNgn: 3_500_000,
    installmentBasePriceNgn: 3_850_000,
    description:
      "A stunning modern apartment in the heart of Lekki Phase 1. This fully serviced property offers the perfect blend of luxury and convenience, featuring contemporary finishes, spacious rooms, and premium amenities.",
    photos: [
      "/properties/1/exterior.jpg",
      "/properties/1/living-room.jpg",
      "/properties/1/master-bedroom.jpg",
      "/properties/1/kitchen.jpg",
      "/properties/1/bathroom.jpg",
    ],
  },
  {
    address: "Plot 42, Aminu Kano Crescent, Wuse 2, Abuja",
    city: "Abuja",
    area: "Wuse 2",
    bedrooms: 2,
    bathrooms: 2,
    annualRentNgn: 2_800_000,
    outrightPriceNgn: 2_800_000,
    installmentBasePriceNgn: 3_080_000,
    description:
      "A beautifully designed 2 bedroom apartment in the prestigious Wuse 2 area. Features modern architecture, quality finishes, and is located close to shopping centers, restaurants, and major business districts.",
    photos: [
      "/properties/2/exterior.jpg",
      "/properties/2/living-room.jpg",
      "/properties/2/master-bedroom.jpg",
      "/properties/2/kitchen.jpg",
      "/properties/2/bathroom.jpg",
    ],
  },
  {
    address: "7 Bourdillon Road, Ikoyi, Lagos",
    city: "Lagos",
    area: "Ikoyi",
    bedrooms: 4,
    bathrooms: 4,
    annualRentNgn: 8_500_000,
    outrightPriceNgn: 8_500_000,
    installmentBasePriceNgn: 9_350_000,
    description:
      "An exquisite luxury duplex in the most sought-after neighborhood in Lagos. This property features premium finishes, smart home technology, a private garden, and direct access to the best schools and entertainment venues.",
    photos: [
      "/properties/3/exterior.jpg",
      "/properties/3/living-room.jpg",
      "/properties/3/master-bedroom.jpg",
      "/properties/3/kitchen.jpg",
      "/properties/3/bathroom.jpg",
      "/properties/3/pool.jpg",
    ],
  },
  {
    address: "25 Herbert Macaulay Way, Yaba, Lagos",
    city: "Lagos",
    area: "Yaba",
    bedrooms: 1,
    bathrooms: 1,
    annualRentNgn: 1_200_000,
    outrightPriceNgn: 1_200_000,
    installmentBasePriceNgn: 1_320_000,
    description:
      "A compact and efficient studio apartment perfect for young professionals. Located in the vibrant Yaba tech hub with easy access to transportation, coworking spaces, and nightlife.",
    photos: [
      "/properties/4/exterior.jpg",
      "/properties/4/studio.jpg",
      "/properties/4/bedroom.jpg",
      "/properties/4/kitchen.jpg",
      "/properties/4/bathroom.jpg",
    ],
  },
  {
    address: "18 Adeola Odeku Street, Victoria Island, Lagos",
    city: "Lagos",
    area: "Victoria Island",
    bedrooms: 3,
    bathrooms: 3,
    annualRentNgn: 5_500_000,
    outrightPriceNgn: 5_500_000,
    installmentBasePriceNgn: 6_050_000,
    description:
      "A premium executive apartment in the commercial heart of Lagos. Perfect for business executives with proximity to major corporate offices, embassies, and high-end restaurants.",
    photos: [
      "/properties/5/exterior.jpg",
      "/properties/5/living-room.jpg",
      "/properties/5/master-bedroom.jpg",
      "/properties/5/kitchen.jpg",
      "/properties/5/bathroom.jpg",
    ],
  },
  {
    address: "12 1st Avenue, Gwarimpa Estate, Abuja",
    city: "Abuja",
    area: "Gwarimpa",
    bedrooms: 4,
    bathrooms: 3,
    annualRentNgn: 4_200_000,
    outrightPriceNgn: 4_200_000,
    installmentBasePriceNgn: 4_620_000,
    description:
      "A spacious family bungalow in the serene Gwarimpa estate. Features a large compound, boys quarters, and is located in a child-friendly neighborhood with good schools nearby.",
    photos: [
      "/properties/6/exterior.jpg",
      "/properties/6/living-room.jpg",
      "/properties/6/master-bedroom.jpg",
      "/properties/6/kitchen.jpg",
      "/properties/6/bathroom.jpg",
    ],
  },
  {
    address: "8 Joel Ogunnaike Street, Ikeja GRA, Lagos",
    city: "Lagos",
    area: "Ikeja GRA",
    bedrooms: 2,
    bathrooms: 2,
    annualRentNgn: 2_400_000,
    outrightPriceNgn: 2_400_000,
    installmentBasePriceNgn: 2_640_000,
    description:
      "A newly renovated apartment in the quiet Ikeja GRA neighborhood. Close to the domestic airport and major shopping malls, perfect for frequent travelers.",
    photos: [
      "/properties/7/exterior.jpg",
      "/properties/7/living-room.jpg",
      "/properties/7/master-bedroom.jpg",
      "/properties/7/kitchen.jpg",
      "/properties/7/bathroom.jpg",
    ],
  },
  {
    address: "3 Banana Island Road, Ikoyi, Lagos",
    city: "Lagos",
    area: "Banana Island",
    bedrooms: 5,
    bathrooms: 5,
    annualRentNgn: 15_000_000,
    outrightPriceNgn: 15_000_000,
    installmentBasePriceNgn: 16_500_000,
    description:
      "The ultimate in luxury living. This penthouse offers panoramic views of the Lagos lagoon, private elevator access, and world-class amenities.",
    photos: [
      "/properties/8/exterior.jpg",
      "/properties/8/living-room.jpg",
      "/properties/8/master-bedroom.jpg",
      "/properties/8/kitchen.jpg",
      "/properties/8/bathroom.jpg",
      "/properties/8/pool.jpg",
    ],
  },
];

async function seedSampleProperties(): Promise<void> {
  const pool = await getPool();
  if (!pool) {
    console.warn("[seed:properties] DATABASE_URL not set, skipping.");
    return;
  }

  const { rows } = await pool.query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM whistleblower_listings WHERE deleted_at IS NULL",
  );
  if (Number(rows[0].count) > 0) {
    console.log(
      `[seed:properties] whistleblower_listings already has ${rows[0].count} row(s), skipping seed.`,
    );
    await pool.end();
    return;
  }

  for (const [index, property] of SAMPLE_PROPERTIES.entries()) {
    await pool.query(
      `INSERT INTO whistleblower_listings (
        whistleblower_id, address, city, area, bedrooms, bathrooms,
        annual_rent_ngn, outright_price_ngn, installment_base_price_ngn,
        description, photos, status, has_verified_inspection, trust_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 'approved', true, 80)`,
      [
        `seed-whistleblower-${index + 1}`,
        property.address,
        property.city,
        property.area,
        property.bedrooms,
        property.bathrooms,
        property.annualRentNgn,
        property.outrightPriceNgn,
        property.installmentBasePriceNgn,
        property.description,
        JSON.stringify(property.photos),
      ],
    );
  }

  console.log(`[seed:properties] Inserted ${SAMPLE_PROPERTIES.length} sample listings.`);
  await pool.end();
}

seedSampleProperties().catch((error) => {
  console.error("[seed:properties] Failed:", error);
  process.exit(1);
});
