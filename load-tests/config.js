// Shared configuration for k6 load tests
// Usage: import { BASE_URL, defaultHeaders, thresholds } from './config.js';

/**
 * Base URL for the API under test.
 * Override with:  k6 run -e BASE_URL=https://staging.example.com ...
 */
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

/**
 * Bearer token for authenticated endpoints.
 * Override with:  k6 run -e AUTH_TOKEN=<real-token> ...
 */
export const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-token';

/**
 * Default headers sent with every request.
 */
export const defaultHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${AUTH_TOKEN}`,
};

/**
 * Global performance thresholds.
 *
 * - p(95) response time must stay below 500 ms
 * - Fewer than 1 % of requests may fail
 */
export const thresholds = {
  http_req_duration: ['p(95)<500'], // 95th percentile < 500 ms
  http_req_failed: ['rate<0.01'],   // Error rate < 1 %
};

/**
 * Convenience wrapper: thresholds + an "env" tag.
 * Scenarios can spread this into their own `options` object.
 */
export const defaultOptions = {
  thresholds,
  tags: {
    env: __ENV.ENVIRONMENT || 'local',
  },
};
