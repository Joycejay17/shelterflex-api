/**
 * Property Search — k6 Load Test
 *
 * Simulates 100 concurrent tenants searching property listings with various
 * filter combinations (location, price range, bedrooms, property type).
 *
 * Endpoint under test:  GET /api/properties/search
 *
 * Run:
 *   k6 run load-tests/scenarios/property-search.js
 *   k6 run -e BASE_URL=https://staging.example.com load-tests/scenarios/property-search.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, defaultHeaders, thresholds } from '../config.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export const options = {
  stages: [
    { duration: '30s', target: 100 }, // ramp up to 100 VUs
    { duration: '60s', target: 100 }, // sustain 100 VUs
    { duration: '10s', target: 0 },   // ramp down
  ],
  thresholds,
  tags: {
    env: __ENV.ENVIRONMENT || 'local',
    scenario: 'property-search',
  },
};

// ---------------------------------------------------------------------------
// Helpers — search filter variations
// ---------------------------------------------------------------------------

/** Sample filter combinations a typical tenant might use. */
const SEARCH_FILTERS = [
  { location: 'Lagos', minPrice: '50000', maxPrice: '200000' },
  { location: 'Abuja', bedrooms: '2', propertyType: 'apartment' },
  { location: 'Lagos', bedrooms: '3', minPrice: '100000', maxPrice: '500000' },
  { propertyType: 'house', minPrice: '200000' },
  { location: 'Port Harcourt', propertyType: 'apartment', bedrooms: '1' },
  { location: 'Lagos', propertyType: 'studio' },
  { bedrooms: '4', maxPrice: '1000000' },
  { location: 'Ibadan', minPrice: '30000', maxPrice: '100000', bedrooms: '2' },
];

/**
 * Build a query-string from a filter object.
 * e.g. { location: 'Lagos', bedrooms: '2' } → '?location=Lagos&bedrooms=2'
 */
function toQueryString(filters) {
  const params = Object.entries(filters)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return params ? `?${params}` : '';
}

// ---------------------------------------------------------------------------
// Default function — executed once per VU iteration
// ---------------------------------------------------------------------------
export default function () {
  group('Property Search', () => {
    // Pick a random filter combination for this iteration
    const filters = SEARCH_FILTERS[Math.floor(Math.random() * SEARCH_FILTERS.length)];
    const qs = toQueryString(filters);

    group('Search with filters', () => {
      const res = http.get(`${BASE_URL}/api/properties/search${qs}`, {
        headers: defaultHeaders,
        tags: { name: 'GET /api/properties/search' },
      });

      check(res, {
        'status is 200': (r) => r.status === 200,
        'response has success field': (r) => {
          try {
            return JSON.parse(r.body).success === true;
          } catch {
            return false;
          }
        },
        'response has data array': (r) => {
          try {
            return Array.isArray(JSON.parse(r.body).data);
          } catch {
            return false;
          }
        },
        'response has pagination': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.total !== undefined && body.page !== undefined;
          } catch {
            return false;
          }
        },
      });
    });

    // Simulate clicking into a specific listing (if data was returned)
    group('Get single property', () => {
      // Use a placeholder property ID — in a real run you would extract from the search results
      const res = http.get(`${BASE_URL}/api/properties/test-property-1`, {
        headers: defaultHeaders,
        tags: { name: 'GET /api/properties/:id' },
      });

      check(res, {
        'single property status is 200 or 404': (r) =>
          r.status === 200 || r.status === 404,
      });
    });
  });

  // Simulate think-time between iterations
  sleep(1);
}
