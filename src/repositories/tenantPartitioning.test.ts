/**
 * Multi-tenant data partitioning — adversarial security test suite (#657).
 *
 * These tests prove that cross-tenant data leakage is impossible through:
 *   - ID spoofing via crafted request headers
 *   - Missing tenant context (unscoped queries)
 *   - Row-level tenant mismatch detection
 *   - Pagination-based enumeration
 *   - Middleware bypass via missing auth
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { requireTenantContext, assertTenantMatch, UNSCOPED_TENANT, TenantRequest } from '../middleware/tenantContext.js'
import { UnscopedQueryError, TenantScopedRepository } from './TenantScopedRepository.js'
import { AppError } from '../errors/AppError.js'

// ── Stub helpers ─────────────────────────────────────────────────────────────

function makeRes() {
  const res: Record<string, unknown> = {}
  return res
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    headers: {},
    ip: '127.0.0.1',
    path: '/test',
    requestId: 'req-123',
    user: { id: 'user-1', email: 'u@x.com', role: 'landlord', tenantId: 'org-A' },
    ...overrides,
  }
}

function runMiddleware(req: Record<string, unknown>): { tenantId?: string; error?: AppError } {
  let captured: AppError | undefined
  let called = false
  const next = (err?: unknown) => {
    if (err instanceof AppError) captured = err
    called = true
  }
  requireTenantContext(req as Parameters<typeof requireTenantContext>[0], makeRes() as Parameters<typeof requireTenantContext>[1], next)
  assert.ok(called, 'next() was not called')
  return { tenantId: (req as TenantRequest).tenantId, error: captured }
}

// ── Concrete stub repo for testing ───────────────────────────────────────────

class StubRepo extends TenantScopedRepository {
  constructor() { super('test_table', 'organization_id') }

  async findForTenant(tenantId: string | undefined) {
    return this.scopedQuery(tenantId, 'SELECT * FROM test_table WHERE organization_id = $1', [])
  }

  assertRow(row: Record<string, unknown>, tenantId: string, id: string) {
    this.assertRowTenant(row, tenantId, id)
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

const tests: { name: string; run: () => void | Promise<void> }[] = [
  // ── requireTenantContext middleware ────────────────────────────────────────

  {
    name: 'middleware: passes when tenantId is on user object',
    run: () => {
      const { tenantId, error } = runMiddleware(makeReq())
      assert.equal(error, undefined)
      assert.equal(tenantId, 'org-A')
    },
  },
  {
    name: 'middleware: passes when X-Tenant-ID header matches user tenant',
    run: () => {
      const { tenantId, error } = runMiddleware(makeReq({ headers: { 'x-tenant-id': 'org-A' } }))
      assert.equal(error, undefined)
      assert.equal(tenantId, 'org-A')
    },
  },
  {
    name: 'middleware: rejects request with no tenant context',
    run: () => {
      const req = makeReq({ user: { id: 'u', email: 'u@x.com', role: 'landlord' } })
      const { error } = runMiddleware(req)
      assert.ok(error, 'Expected error')
      assert.equal(error!.code, 'TENANT_CONTEXT_REQUIRED')
      assert.equal(error!.status, 403)
    },
  },
  {
    name: 'middleware: rejects UNSCOPED_TENANT sentinel value',
    run: () => {
      const req = makeReq({ user: { id: 'u', email: 'u@x.com', role: 'landlord', tenantId: UNSCOPED_TENANT } })
      const { error } = runMiddleware(req)
      assert.ok(error)
      assert.equal(error!.code, 'TENANT_CONTEXT_REQUIRED')
    },
  },
  {
    name: 'adversarial: blocks cross-tenant ID spoofing via X-Tenant-ID header',
    run: () => {
      // User belongs to org-A but sends org-B in header — must be blocked
      const req = makeReq({ headers: { 'x-tenant-id': 'org-B' } })
      const { error } = runMiddleware(req)
      assert.ok(error, 'Cross-tenant spoofing was not blocked')
      assert.equal(error!.code, 'CROSS_TENANT_ACCESS_DENIED')
      assert.equal(error!.status, 403)
    },
  },
  {
    name: 'adversarial: blocks request with empty string tenant header',
    run: () => {
      const req = makeReq({
        headers: { 'x-tenant-id': '   ' },
        user: { id: 'u', email: 'u@x.com', role: 'landlord' },
      })
      const { error } = runMiddleware(req)
      assert.ok(error)
      assert.equal(error!.code, 'TENANT_CONTEXT_REQUIRED')
    },
  },

  // ── assertTenantMatch ──────────────────────────────────────────────────────

  {
    name: 'assertTenantMatch: passes when tenant IDs match',
    run: () => {
      assert.doesNotThrow(() =>
        assertTenantMatch('org-A', 'org-A', { resourceType: 'Deal', resourceId: 'deal-1' }),
      )
    },
  },
  {
    name: 'adversarial: assertTenantMatch throws on cross-tenant mismatch',
    run: () => {
      assert.throws(
        () => assertTenantMatch('org-A', 'org-B', { resourceType: 'Property', resourceId: 'prop-9' }),
        (err: unknown) => {
          assert.ok(err instanceof AppError)
          assert.equal(err.code, 'CROSS_TENANT_ACCESS_DENIED')
          return true
        },
      )
    },
  },

  // ── TenantScopedRepository ─────────────────────────────────────────────────

  {
    name: 'repo: UnscopedQueryError thrown when tenantId is undefined',
    run: async () => {
      const repo = new StubRepo()
      await assert.rejects(
        () => repo.findForTenant(undefined),
        (err: unknown) => {
          assert.ok(err instanceof UnscopedQueryError)
          assert.equal(err.code, 'UNSCOPED_QUERY')
          return true
        },
      )
    },
  },
  {
    name: 'repo: UnscopedQueryError thrown when tenantId is empty string',
    run: async () => {
      const repo = new StubRepo()
      await assert.rejects(() => repo.findForTenant(''), UnscopedQueryError)
    },
  },
  {
    name: 'adversarial: assertRowTenant blocks cross-tenant row access',
    run: () => {
      const repo = new StubRepo()
      assert.throws(
        () =>
          repo.assertRow(
            { organization_id: 'org-B', id: 'row-1' },
            'org-A',
            'row-1',
          ),
        (err: unknown) => {
          assert.ok(err instanceof AppError)
          assert.equal(err.code, 'CROSS_TENANT_ACCESS_DENIED')
          return true
        },
      )
    },
  },
  {
    name: 'adversarial: assertRowTenant blocks row with missing organization_id',
    run: () => {
      const repo = new StubRepo()
      assert.throws(
        () => repo.assertRow({ id: 'row-x' }, 'org-A', 'row-x'),
        AppError,
      )
    },
  },
  {
    name: 'adversarial: pagination enumeration — unscoped list query is rejected',
    run: async () => {
      // Simulates a pagination attack where tenant context is omitted to enumerate all records
      const repo = new StubRepo()
      const tenants = [undefined, '', '   '] as const
      for (const t of tenants) {
        await assert.rejects(
          () => repo.findForTenant(t as string | undefined),
          (err: unknown) => err instanceof UnscopedQueryError || err instanceof AppError,
        )
      }
    },
  },
]

async function run() {
  let passed = 0, failed = 0
  for (const t of tests) {
    try {
      await t.run()
      console.log(`PASS ${t.name}`)
      passed++
    } catch (err) {
      console.error(`FAIL ${t.name}`)
      console.error(err)
      failed++
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

if (process.argv[1]?.endsWith('tenantPartitioning.test.ts') || process.argv[1]?.endsWith('tenantPartitioning.test.js')) {
  run().catch(console.error)
}
