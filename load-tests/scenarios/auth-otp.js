/**
 * Auth OTP (Rate Limiting) — k6 Load Test
 *
 * Simulates OTP requests and verification under high load.
 *
 * Flow:
 *   1. Request OTP (POST /api/auth/otp/request)
 *   2. Attempt verification (POST /api/auth/otp/verify)
 *
 * Key test: Burst phase triggers rate limiting (HTTP 429).
 * Checks that rate-limited requests return 429 and NOT 500.
 *
 * Run:
 *   k6 run load-tests/scenarios/auth-otp.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, defaultHeaders, thresholds } from '../config.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export const options = {
  stages: [
    { duration: '5s', target: 50 },  // Quick ramp-up to 50 VUs
    { duration: '20s', target: 50 }, // Sustain 50 VUs with burst
    { duration: '5s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    ...thresholds,
    // We expect some requests to fail with 429, so we customize the failed rate check.
    // Instead of absolute failure, we check that we don't get 5xx errors.
    http_req_failed: ['rate<0.5'], // Allow up to 50% rate limiting under heavy burst
  },
  tags: {
    env: __ENV.ENVIRONMENT || 'local',
    scenario: 'auth-otp',
  },
};

// ---------------------------------------------------------------------------
// Default function
// ---------------------------------------------------------------------------
export default function () {
  const email = `k6-user-${__VU}-${__ITER}@example.com`;

  group('OTP Lifecycle', () => {
    // Step 1: Request OTP
    group('Request OTP', () => {
      const payload = JSON.stringify({ email });
      const res = http.post(`${BASE_URL}/api/auth/otp/request`, payload, {
        headers: defaultHeaders,
        tags: { name: 'POST /api/auth/otp/request' },
      });

      check(res, {
        'otp status is 200 or 429': (r) => r.status === 200 || r.status === 429,
        'not 500 error': (r) => r.status !== 500,
      });
    });

    // Short think time
    sleep(0.5);

    // Step 2: Verify OTP
    group('Verify OTP', () => {
      const payload = JSON.stringify({ email, code: '123456' }); // Dummy OTP code
      const res = http.post(`${BASE_URL}/api/auth/otp/verify`, payload, {
        headers: defaultHeaders,
        tags: { name: 'POST /api/auth/otp/verify' },
      });

      check(res, {
        'verify status is 200, 400, or 429': (r) =>
          r.status === 200 || r.status === 400 || r.status === 429,
        'not 500 error': (r) => r.status !== 500,
      });
    });
  });

  // Short delay to maintain high rate
  sleep(0.5);
}
