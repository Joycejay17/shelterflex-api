/**
 * Underwriting / Tenant Screening — k6 Load Test
 *
 * Simulates CPU-intensive tenant screening (background-check) requests.
 *
 * Flow:
 *   1. POST /api/background-check/tenants/:tenantId/background-check
 *   2. Poll GET /api/background-check/tenants/:tenantId/status until complete
 *
 * Additional threshold: p(99) < 2 000 ms — screening is CPU-heavy but should
 * still resolve within 2 s for 99 % of requests.
 *
 * Run:
 *   k6 run load-tests/scenarios/underwriting.js
 *   k6 run -e BASE_URL=https://staging.example.com load-tests/scenarios/underwriting.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, defaultHeaders, thresholds } from '../config.js';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const slowScreenings = new Counter('slow_screening_requests');

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export const options = {
  stages: [
    { duration: '20s', target: 30 }, // ramp up to 30 VUs
    { duration: '60s', target: 30 }, // sustain
    { duration: '10s', target: 0 },  // ramp down
  ],
  thresholds: {
    ...thresholds,
    http_req_duration: ['p(95)<500', 'p(99)<2000'], // p99 < 2 s for screening
  },
  tags: {
    env: __ENV.ENVIRONMENT || 'local',
    scenario: 'underwriting',
  },
};

// ---------------------------------------------------------------------------
// Default function
// ---------------------------------------------------------------------------
export default function () {
  const tenantId = `tenant-screen-vu-${__VU}-${__ITER}`;

  // ------------------------------------------------------------------
  // Step 1 — Submit tenant screening request
  // ------------------------------------------------------------------
  group('Submit screening request', () => {
    const payload = JSON.stringify({
      applicationId: `app-${tenantId}`,
      employerName: 'Acme Corp',
      employeeId: `emp-${__VU}`,
      bankAccountRef: `bank-ref-${__VU}`,
      skipEmployment: false,
      skipIncome: false,
      skipBankStatement: true,
    });

    const res = http.post(
      `${BASE_URL}/api/background-check/tenants/${tenantId}/background-check`,
      payload,
      {
        headers: defaultHeaders,
        tags: { name: 'POST /api/background-check/tenants/:tenantId/background-check' },
      },
    );

    check(res, {
      'screening accepted — 200 or 201 or 202': (r) =>
        r.status === 200 || r.status === 201 || r.status === 202,
      'response is valid JSON': (r) => {
        try {
          JSON.parse(r.body);
          return true;
        } catch {
          return false;
        }
      },
    });

    // Track requests that exceed the 2 s SLO
    if (res.timings.duration > 2000) {
      slowScreenings.add(1);
      console.warn(
        `⚠ Slow screening: VU ${__VU} took ${res.timings.duration.toFixed(0)} ms`,
      );
    }

    // Wait before polling — screening is async in production
    sleep(2);
  });

  // ------------------------------------------------------------------
  // Step 2 — Poll for screening result (underwriting decision)
  // ------------------------------------------------------------------
  group('Poll underwriting decision', () => {
    // Attempt up to 3 polling requests
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = http.get(
        `${BASE_URL}/api/admin/underwriting/decisions`,
        {
          headers: defaultHeaders,
          tags: { name: 'GET /api/admin/underwriting/decisions' },
        },
      );

      const ok = check(res, {
        'decisions status is 200': (r) => r.status === 200,
        'response contains decisions array or object': (r) => {
          try {
            const body = JSON.parse(r.body);
            return typeof body === 'object' && body !== null;
          } catch {
            return false;
          }
        },
      });

      if (ok) break;

      // Back off before next poll
      sleep(1);
    }
  });

  // Think-time between iterations
  sleep(1);
}
