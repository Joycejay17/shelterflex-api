/**
 * Staking Reads (High Concurrency) — k6 Load Test
 *
 * Simulates high-concurrency read operations on staking-related endpoints.
 * These endpoints should ideally use caching and stay extremely fast even under high load.
 *
 * Flow:
 *   1. GET staking balance (GET /api/staking/balance/:address)
 *   2. GET staking stats (GET /api/staking/stats)
 *
 * OPTIONS: 200 VUs, 60s duration
 *
 * Run:
 *   k6 run load-tests/scenarios/staking-read.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, defaultHeaders, thresholds } from '../config.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export const options = {
  stages: [
    { duration: '15s', target: 200 }, // Rapid ramp-up to 200 VUs
    { duration: '60s', target: 200 }, // Sustain 200 VUs
    { duration: '10s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    ...thresholds,
    // Strictly require very fast response times for read operations
    http_req_duration: ['p(95)<200', 'p(99)<400'], // 95% < 200ms, 99% < 400ms
  },
  tags: {
    env: __ENV.ENVIRONMENT || 'local',
    scenario: 'staking-read',
  },
};

// ---------------------------------------------------------------------------
// Default function
// ---------------------------------------------------------------------------
export default function () {
  // Use a variety of mock addresses to simulate multiple stakers
  const mockAddress = `GBXWOP...STAKING...VU${__VU}`;

  group('Staking Read Operations', () => {
    // Step 1: GET staking balance
    group('Get Staking Balance', () => {
      const res = http.get(`${BASE_URL}/api/staking/balance/${mockAddress}`, {
        headers: defaultHeaders,
        tags: { name: 'GET /api/staking/balance/:address' },
      });

      check(res, {
        'balance status is 200 or 404': (r) => r.status === 200 || r.status === 404,
        'response is valid JSON': (r) => {
          try {
            JSON.parse(r.body);
            return true;
          } catch {
            return false;
          }
        },
      });
    });

    // Minimal think-time before fetching stats
    sleep(0.2);

    // Step 2: GET staking stats (global cacheable endpoint)
    group('Get Global Staking Stats', () => {
      const res = http.get(`${BASE_URL}/api/staking/stats`, {
        headers: defaultHeaders,
        tags: { name: 'GET /api/staking/stats' },
      });

      check(res, {
        'stats status is 200': (r) => r.status === 200,
        'stats has pool details': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.totalStaked !== undefined || body.apy !== undefined || body.success === true;
          } catch {
            return false;
          }
        },
      });
    });
  });

  // Small delay before next iteration
  sleep(1);
}
