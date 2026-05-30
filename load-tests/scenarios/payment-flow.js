/**
 * Payment Flow — k6 Load Test
 *
 * Simulates the full payment creation lifecycle:
 *   1. Create a deal (POST /api/deals)
 *   2. Confirm a payment against the deal (POST /api/payments/confirm)
 *   3. Poll deal progress / payment status (GET /api/deals/:dealId/progress)
 *
 * Endpoint prefix:  /api/deals, /api/payments
 *
 * Run:
 *   k6 run load-tests/scenarios/payment-flow.js
 *   k6 run -e BASE_URL=https://staging.example.com load-tests/scenarios/payment-flow.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, defaultHeaders, thresholds } from '../config.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export const options = {
  stages: [
    { duration: '20s', target: 50 }, // ramp up to 50 VUs
    { duration: '60s', target: 50 }, // sustain 50 VUs
    { duration: '10s', target: 0 },  // ramp down
  ],
  thresholds,
  tags: {
    env: __ENV.ENVIRONMENT || 'local',
    scenario: 'payment-flow',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique external reference per iteration to avoid idempotency collisions. */
function uniqueRef() {
  return `k6-${__VU}-${__ITER}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Default function
// ---------------------------------------------------------------------------
export default function () {
  let dealId = null;

  // ------------------------------------------------------------------
  // Step 1 — Create a deal
  // ------------------------------------------------------------------
  group('Create deal', () => {
    const payload = JSON.stringify({
      propertyId: 'prop-load-test-001',
      tenantId: `tenant-vu-${__VU}`,
      landlordId: 'landlord-load-test-001',
      monthlyRent: 150000,
      durationMonths: 12,
      startDate: new Date().toISOString(),
    });

    const res = http.post(`${BASE_URL}/api/deals`, payload, {
      headers: defaultHeaders,
      tags: { name: 'POST /api/deals' },
    });

    check(res, {
      'deal created — 200 or 201': (r) => r.status === 200 || r.status === 201,
      'deal response has id': (r) => {
        try {
          const body = JSON.parse(r.body);
          dealId = body.deal?.id || body.id || body.data?.id || null;
          return dealId !== null;
        } catch {
          return false;
        }
      },
    });

    // Realistic delay: user reviews deal details before paying
    sleep(1);
  });

  // ------------------------------------------------------------------
  // Step 2 — Confirm payment
  // ------------------------------------------------------------------
  group('Confirm payment', () => {
    const payload = JSON.stringify({
      dealId: dealId || `deal-fallback-${__VU}`,
      txType: 'rent_payment',
      amountUsdc: '125.000000',
      tokenAddress: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
      externalRefSource: 'k6-load-test',
      externalRef: uniqueRef(),
    });

    const res = http.post(`${BASE_URL}/api/payments/confirm`, payload, {
      headers: defaultHeaders,
      tags: { name: 'POST /api/payments/confirm' },
    });

    check(res, {
      'payment accepted — 200 or 202': (r) =>
        r.status === 200 || r.status === 202,
      'payment response has outbox or tx info': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.txId !== undefined || body.outboxId !== undefined || body.status !== undefined;
        } catch {
          return false;
        }
      },
    });

    // Realistic delay: wait for confirmation
    sleep(2);
  });

  // ------------------------------------------------------------------
  // Step 3 — Check deal progress / payment status
  // ------------------------------------------------------------------
  group('Check payment status', () => {
    if (!dealId) {
      // If deal creation failed, skip status check
      return;
    }

    const res = http.get(
      `${BASE_URL}/api/deals/${dealId}/progress`,
      {
        headers: defaultHeaders,
        tags: { name: 'GET /api/deals/:dealId/progress' },
      },
    );

    check(res, {
      'progress status is 200 or 404': (r) =>
        r.status === 200 || r.status === 404,
      'progress response shape is valid': (r) => {
        try {
          const body = JSON.parse(r.body);
          // Accept any well-formed JSON response
          return typeof body === 'object' && body !== null;
        } catch {
          return false;
        }
      },
    });
  });

  // Think-time before next iteration
  sleep(1);
}
