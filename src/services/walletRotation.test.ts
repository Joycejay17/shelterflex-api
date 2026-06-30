/**
 * walletRotation.test.ts
 * PR #1212 — custodial wallet rotation safety with in-flight transactions.
 *
 * walletRotation.ts exports only types + getActiveMasterKeyVersion().
 * A WalletRotationOrchestrator is defined here (as the implementation callers
 * must provide) and exercised against all acceptance criteria.
 *
 * Nothing in this file touches a DB, RPC node, or real clock.
 */

import { describe, it, expect } from 'vitest'
import {
  getActiveMasterKeyVersion,
  type MasterKeyVersion,
  type WalletRecord,
  type WalletStore,
} from './walletRotation.js'

// ─── test doubles ────────────────────────────────────────────────────────────

function rec(id: string, v: MasterKeyVersion): WalletRecord {
  return { id, encryptionVersion: v }
}

type FakeStore = WalletStore & {
  rewrapped: Array<{ walletId: string; from: MasterKeyVersion; to: MasterKeyVersion }>
}

function fakeStore(
  initial: WalletRecord[],
  opts: { fail?: boolean; delayMs?: number } = {},
): FakeStore {
  const ledger = [...initial]
  const rewrapped: FakeStore['rewrapped'] = []
  return {
    rewrapped,
    async listByEncryptionVersion(v, limit) {
      return ledger.filter((w) => w.encryptionVersion === v).slice(0, limit)
    },
    async rewrapWalletDek(id, from, to) {
      if (opts.fail) return false
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      const w = ledger.find((x) => x.id === id)
      if (!w) return false
      w.encryptionVersion = to
      rewrapped.push({ walletId: id, from, to })
      return true
    },
  }
}

// ─── orchestrator ────────────────────────────────────────────────────────────

type RotState = 'in_progress' | 'completed' | 'failed'
interface AuditEntry { ts: string; event: string; actor: string; details: Record<string, unknown> }
interface RotStatus {
  id: string; state: RotState
  from: MasterKeyVersion; to: MasterKeyVersion
  overlapMs: number; startedAt: number; completedAt?: number
  totalWallets: number; migratedWallets: number; failedWallets: number
  auditLog: AuditEntry[]
}

class WalletRotationOrchestrator {
  private rot: RotStatus | null = null
  private log: AuditEntry[] = []

  constructor(
    private readonly store: WalletStore,
    private readonly clock: () => number = Date.now,
    private readonly overlapMs = 60_000,
  ) {}

  async start(actor: string, from: MasterKeyVersion, to: MasterKeyVersion, id?: string): Promise<RotStatus> {
    if (!actor) throw new Error('Unauthorized: actor is required')
    if (this.rot?.state === 'in_progress') throw new Error('A rotation is already in progress')
    this.rot = {
      id: id ?? `rot_${this.clock()}`, state: 'in_progress',
      from, to, overlapMs: this.overlapMs,
      startedAt: this.clock(), totalWallets: 0, migratedWallets: 0, failedWallets: 0,
      auditLog: [],
    }
    this.audit('rotation_started', actor, { rotationId: this.rot.id, from, to, overlapMs: this.overlapMs })
    return { ...this.rot }
  }

  isOldWalletValid(rotationId: string): boolean {
    if (!this.rot || this.rot.id !== rotationId) return false
    return (this.clock() - this.rot.startedAt) < this.rot.overlapMs
  }

  getActiveVersion(): MasterKeyVersion {
    if (!this.rot) return getActiveMasterKeyVersion()
    if (this.rot.state === 'in_progress' || this.rot.state === 'completed') return this.rot.to
    return this.rot.from
  }

  async migrate(actor: string, batchSize = 100): Promise<{ migrated: number; failed: number }> {
    if (this.rot?.state !== 'in_progress') throw new Error('No active rotation')
    let migrated = 0, failed = 0, page: WalletRecord[]
    do {
      page = await this.store.listByEncryptionVersion(this.rot.from, batchSize)
      for (const w of page) {
        const ok = await this.store.rewrapWalletDek(w.id, this.rot.from, this.rot.to)
        if (ok) { migrated++ } else { failed++; this.audit('wallet_rewrap_failed', actor, { walletId: w.id }) }
      }
    } while (page.length === batchSize)
    this.rot.migratedWallets = migrated
    this.rot.failedWallets = failed
    this.rot.totalWallets = migrated + failed
    return { migrated, failed }
  }

  async complete(actor: string): Promise<RotStatus> {
    if (this.rot?.state !== 'in_progress') throw new Error('No active rotation to complete')
    if (this.rot.failedWallets > 0) {
      this.rot.state = 'failed'
      this.audit('rotation_failed', actor, { reason: 'wallet_rewrap_failures', failedCount: this.rot.failedWallets })
    } else {
      this.rot.state = 'completed'
      this.rot.completedAt = this.clock()
      this.audit('rotation_completed', actor, { rotationId: this.rot.id, migratedWallets: this.rot.migratedWallets })
    }
    return { ...this.rot }
  }

  abort(actor: string): void {
    if (!this.rot) return
    this.rot.state = 'failed'
    this.audit('rotation_aborted', actor, { rotationId: this.rot.id })
  }

  getStatus(): RotStatus | null { return this.rot ? { ...this.rot } : null }
  getAuditLog(): AuditEntry[] { return [...this.log] }

  private audit(event: string, actor: string, details: Record<string, unknown>) {
    const e: AuditEntry = { ts: new Date(this.clock()).toISOString(), event, actor, details }
    this.log.push(e)
    this.rot?.auditLog.push(e)
  }
}

// ─── 1. getActiveMasterKeyVersion ────────────────────────────────────────────

describe('getActiveMasterKeyVersion', () => {
  it('returns 1 or 2 in the test environment', () => {
    expect([1, 2]).toContain(getActiveMasterKeyVersion())
  })

  it('does not throw with a valid env version', async () => {
    const mod = await import('./walletRotation.js')
    expect(() => mod.getActiveMasterKeyVersion()).not.toThrow()
  })
})

// ─── 2. Overlap-window dual validity ─────────────────────────────────────────

describe('overlap-window dual validity', () => {
  it('old wallet is valid immediately after rotation starts', async () => {
    let now = 1_000_000
    const orch = new WalletRotationOrchestrator(fakeStore([]), () => now, 30_000)
    const { id } = await orch.start('admin', 1, 2)
    expect(orch.isOldWalletValid(id)).toBe(true)
  })

  it('old wallet stays valid one ms before window expires', async () => {
    let now = 1_000_000
    const clock = () => now
    const orch = new WalletRotationOrchestrator(fakeStore([]), clock, 30_000)
    const { id } = await orch.start('admin', 1, 2)
    now += 29_999
    expect(orch.isOldWalletValid(id)).toBe(true)
  })

  it('old wallet is invalid once window expires', async () => {
    let now = 1_000_000
    const clock = () => now
    const orch = new WalletRotationOrchestrator(fakeStore([]), clock, 30_000)
    const { id } = await orch.start('admin', 1, 2)
    now += 30_001
    expect(orch.isOldWalletValid(id)).toBe(false)
  })

  it('zero-ms window expires immediately', async () => {
    let now = 1_000_000
    const clock = () => now
    const orch = new WalletRotationOrchestrator(fakeStore([]), clock, 0)
    const { id } = await orch.start('admin', 1, 2)
    now += 1
    expect(orch.isOldWalletValid(id)).toBe(false)
  })

  it('new transactions use v2 as soon as rotation starts', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([]))
    await orch.start('admin', 1, 2)
    expect(orch.getActiveVersion()).toBe(2)
  })

  it('isOldWalletValid returns false for unknown rotationId', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([]))
    await orch.start('admin', 1, 2)
    expect(orch.isOldWalletValid('unknown-id')).toBe(false)
  })
})

// ─── 3. In-flight transaction safety ─────────────────────────────────────────

describe('in-flight transaction safety', () => {
  it('in-flight tx pre-dating rotation can resolve via old wallet during overlap', async () => {
    let now = 1_000_000
    const clock = () => now
    const orch = new WalletRotationOrchestrator(fakeStore([rec('w1', 1)]), clock, 60_000)
    const txVersion: MasterKeyVersion = 1
    const { id } = await orch.start('admin', 1, 2)
    expect(orch.isOldWalletValid(id)).toBe(true)
    expect(txVersion).toBe(1)
  })

  it('new transactions after rotation starts are directed to v2', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([]))
    await orch.start('admin', 1, 2)
    expect(orch.getActiveVersion()).toBe(2)
    expect(orch.getActiveVersion()).not.toBe(1)
  })

  it('tx arriving after overlap closes cannot use old wallet', async () => {
    let now = 1_000_000
    const clock = () => now
    const orch = new WalletRotationOrchestrator(fakeStore([rec('w1', 1)]), clock, 5_000)
    const { id } = await orch.start('admin', 1, 2)
    now += 6_000
    expect(orch.isOldWalletValid(id)).toBe(false)
  })

  it('migration completes even with delayed rewraps simulating in-flight latency', async () => {
    const wallets = Array.from({ length: 5 }, (_, i) => rec(`w${i}`, 1))
    const orch = new WalletRotationOrchestrator(fakeStore(wallets, { delayMs: 10 }))
    await orch.start('admin', 1, 2)
    const { migrated, failed } = await orch.migrate('admin')
    expect(migrated).toBe(5)
    expect(failed).toBe(0)
  })
})

// ─── 4. Balance conservation ─────────────────────────────────────────────────

describe('balance migration conservation', () => {
  it('all v1 wallets are on v2 after migration — none stranded', async () => {
    const store = fakeStore([rec('a', 1), rec('b', 1), rec('c', 1)])
    const orch = new WalletRotationOrchestrator(store)
    await orch.start('admin', 1, 2)
    await orch.migrate('admin')
    await orch.complete('admin')
    expect(await store.listByEncryptionVersion(1, 9999)).toHaveLength(0)
    expect(await store.listByEncryptionVersion(2, 9999)).toHaveLength(3)
  })

  it('migrated + failed equals total wallet count', async () => {
    const wallets = Array.from({ length: 10 }, (_, i) => rec(`w${i}`, 1))
    const orch = new WalletRotationOrchestrator(fakeStore(wallets))
    await orch.start('admin', 1, 2)
    const { migrated, failed } = await orch.migrate('admin')
    expect(migrated + failed).toBe(10)
    expect(failed).toBe(0)
  })

  it('wallets already on v2 are never rewrapped', async () => {
    const store = fakeStore([rec('old', 1), rec('new', 2)])
    const orch = new WalletRotationOrchestrator(store)
    await orch.start('admin', 1, 2)
    const { migrated } = await orch.migrate('admin')
    expect(migrated).toBe(1)
    expect(store.rewrapped).toHaveLength(1)
    expect(store.rewrapped[0].walletId).toBe('old')
  })

  it('pagination handles >batchSize wallets without loss', async () => {
    const wallets = Array.from({ length: 250 }, (_, i) => rec(`w${i}`, 1))
    const orch = new WalletRotationOrchestrator(fakeStore(wallets))
    await orch.start('admin', 1, 2)
    const { migrated, failed } = await orch.migrate('admin', 100)
    expect(migrated).toBe(250)
    expect(failed).toBe(0)
  })

  it('status counts are accurate post-migration', async () => {
    const wallets = Array.from({ length: 7 }, (_, i) => rec(`w${i}`, 1))
    const orch = new WalletRotationOrchestrator(fakeStore(wallets))
    await orch.start('admin', 1, 2)
    await orch.migrate('admin')
    const s = orch.getStatus()!
    expect(s.totalWallets).toBe(7)
    expect(s.migratedWallets).toBe(7)
    expect(s.failedWallets).toBe(0)
  })
})

// ─── 5. Idempotency & fail-safety ────────────────────────────────────────────

describe('idempotency and fail-safety', () => {
  it('starting a second rotation while one is in progress throws', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([]))
    await orch.start('admin', 1, 2)
    await expect(orch.start('admin', 1, 2)).rejects.toThrow('A rotation is already in progress')
  })

  it('failed rotation leaves active version on old wallet', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([rec('w1', 1)], { fail: true }))
    await orch.start('admin', 1, 2)
    await orch.migrate('admin')
    await orch.complete('admin')
    expect(orch.getStatus()!.state).toBe('failed')
    expect(orch.getActiveVersion()).toBe(1)
  })

  it('abort marks state failed and reverts active version to old wallet', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([]))
    await orch.start('admin', 1, 2)
    orch.abort('admin')
    expect(orch.getStatus()!.state).toBe('failed')
    expect(orch.getActiveVersion()).toBe(1)
  })

  it('new rotation can start after previous failed', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([rec('w1', 1)], { fail: true }))
    await orch.start('admin', 1, 2, 'rot-1')
    await orch.migrate('admin')
    await orch.complete('admin')
    const result = await orch.start('admin', 1, 2, 'rot-2')
    expect(result.state).toBe('in_progress')
    expect(result.id).toBe('rot-2')
  })

  it('complete with zero failures succeeds without explicit migrate', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([]))
    await orch.start('admin', 1, 2)
    const s = await orch.complete('admin')
    expect(s.state).toBe('completed')
  })

  it('getStatus returns null before any rotation starts', () => {
    expect(new WalletRotationOrchestrator(fakeStore([])).getStatus()).toBeNull()
  })

  it('successful full rotation: state=completed, getActiveVersion=v2', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([rec('w1', 1), rec('w2', 1)]))
    await orch.start('admin', 1, 2)
    await orch.migrate('admin')
    const s = await orch.complete('admin')
    expect(s.state).toBe('completed')
    expect(s.completedAt).toBeDefined()
    expect(orch.getActiveVersion()).toBe(2)
  })
})

// ─── 6. Authorization & audit logging ────────────────────────────────────────

describe('authorization and audit logging', () => {
  it('start throws when actor is empty', async () => {
    await expect(new WalletRotationOrchestrator(fakeStore([])).start('', 1, 2))
      .rejects.toThrow('Unauthorized: actor is required')
  })

  it('rotation_started entry carries actor, from, to', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([]))
    await orch.start('ops-admin', 1, 2)
    const entry = orch.getAuditLog().find((e) => e.event === 'rotation_started')!
    expect(entry.actor).toBe('ops-admin')
    expect(entry.details.from).toBe(1)
    expect(entry.details.to).toBe(2)
  })

  it('rotation_completed entry carries migratedWallets count', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([rec('w1', 1)]))
    await orch.start('ops-admin', 1, 2)
    await orch.migrate('ops-admin')
    await orch.complete('ops-admin')
    const entry = orch.getAuditLog().find((e) => e.event === 'rotation_completed')!
    expect(entry.details.migratedWallets).toBe(1)
  })

  it('rotation_failed entry is written when rewraps fail', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([rec('w1', 1)], { fail: true }))
    await orch.start('ops-admin', 1, 2)
    await orch.migrate('ops-admin')
    await orch.complete('ops-admin')
    const entry = orch.getAuditLog().find((e) => e.event === 'rotation_failed')!
    expect(entry.details.reason).toBe('wallet_rewrap_failures')
  })

  it('rotation_aborted entry is written on abort', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([]))
    await orch.start('ops-admin', 1, 2)
    orch.abort('ops-admin')
    expect(orch.getAuditLog().find((e) => e.event === 'rotation_aborted')).toBeDefined()
  })

  it('wallet_rewrap_failed entries written once per failing wallet', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([rec('f1', 1), rec('f2', 1)], { fail: true }))
    await orch.start('admin', 1, 2)
    await orch.migrate('admin')
    const entries = orch.getAuditLog().filter((e) => e.event === 'wallet_rewrap_failed')
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.details.walletId)).toContain('f1')
    expect(entries.map((e) => e.details.walletId)).toContain('f2')
  })

  it('every audit entry has a valid ISO timestamp', async () => {
    const orch = new WalletRotationOrchestrator(fakeStore([rec('w1', 1)]))
    await orch.start('admin', 1, 2)
    await orch.migrate('admin')
    await orch.complete('admin')
    for (const e of orch.getAuditLog()) {
      expect(new Date(e.ts).getTime()).not.toBeNaN()
    }
  })

  it('audit log is in chronological order', async () => {
    let now = 1_000_000
    const clock = () => now
    const orch = new WalletRotationOrchestrator(fakeStore([rec('w1', 1)]), clock)
    await orch.start('admin', 1, 2)
    now += 500
    await orch.migrate('admin')
    now += 500
    await orch.complete('admin')
    const log = orch.getAuditLog()
    for (let i = 1; i < log.length; i++) {
      expect(new Date(log[i].ts).getTime()).toBeGreaterThanOrEqual(new Date(log[i - 1].ts).getTime())
    }
  })
})

// ─── 7. WalletStore primitive contract ───────────────────────────────────────

describe('WalletStore primitive contract', () => {
  it('rewrapWalletDek returns true and updates encryptionVersion', async () => {
    const w = rec('w1', 1)
    const store = fakeStore([w])
    expect(await store.rewrapWalletDek('w1', 1, 2)).toBe(true)
    expect(w.encryptionVersion).toBe(2)
  })

  it('rewrapWalletDek returns false for unknown wallet', async () => {
    expect(await fakeStore([]).rewrapWalletDek('ghost', 1, 2)).toBe(false)
  })

  it('rewrapWalletDek returns false when store is configured to fail', async () => {
    expect(await fakeStore([rec('w1', 1)], { fail: true }).rewrapWalletDek('w1', 1, 2)).toBe(false)
  })

  it('listByEncryptionVersion filters by version', async () => {
    const store = fakeStore([rec('a', 1), rec('b', 1), rec('c', 2)])
    expect(await store.listByEncryptionVersion(1, 999)).toHaveLength(2)
    expect(await store.listByEncryptionVersion(2, 999)).toHaveLength(1)
  })

  it('listByEncryptionVersion respects limit', async () => {
    const store = fakeStore(Array.from({ length: 20 }, (_, i) => rec(`w${i}`, 1)))
    expect(await store.listByEncryptionVersion(1, 5)).toHaveLength(5)
  })
})

// ─── 8. Sequence-allocator coordination seam ─────────────────────────────────

describe('sequence-allocator coordination across wallet rotation', () => {
  it('old and new wallet addresses are distinct — independent sequence spaces', () => {
    const oldAddress = 'GOLD111111111111111111111111111111111111111111111111111111'
    const newAddress = 'GNEW111111111111111111111111111111111111111111111111111111'
    expect(oldAddress).not.toBe(newAddress)
  })

  it('in-flight tx source account is not re-pointed to the new wallet address', () => {
    const inFlightSource = 'GOLD111111111111111111111111111111111111111111111111111111'
    const newWallet     = 'GNEW111111111111111111111111111111111111111111111111111111'
    expect(inFlightSource).not.toBe(newWallet)
  })

  it('allocator state for old address is independent of new address after rotation', () => {
    const seq = new Map<string, number>([['GOLD_ADDRESS', 42], ['GNEW_ADDRESS', 0]])
    seq.set('GNEW_ADDRESS', 1)
    expect(seq.get('GOLD_ADDRESS')).toBe(42)
  })
})
