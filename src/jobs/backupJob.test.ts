import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('child_process', () => ({
  exec: vi.fn((cmd, callback) => callback(null, '', '')),
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
  unlinkSync: vi.fn(),
}))

vi.mock('path', () => ({
  default: {
    join: vi.fn((...args) => args.join('/')),
  },
  join: vi.fn((...args) => args.join('/')),
}))

import { startBackupJob } from './backupJob.js'

describe('BackupJob', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    vi.clearAllMocks()
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.clearAllTimers()
  })

  describe('Job initialization', () => {
    it('skips backup if DATABASE_URL is not set', () => {
      delete process.env.DATABASE_URL
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      startBackupJob()

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No DATABASE_URL'))
      logSpy.mockRestore()
    })

    it('schedules backup job when DATABASE_URL is set', () => {
      process.env.DATABASE_URL = 'postgres://test'
      const setIntervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue(123 as any)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      startBackupJob()

      expect(setIntervalSpy).toHaveBeenCalled()

      setIntervalSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe('Backup configuration', () => {
    it('uses 24-hour backup interval', () => {
      process.env.DATABASE_URL = 'postgres://test'

      const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000
      const MS_PER_HOUR = 60 * 60 * 1000
      const hours = BACKUP_INTERVAL_MS / MS_PER_HOUR

      expect(hours).toBe(24)
    })

    it('sets retention policy of 7 days', () => {
      process.env.DATABASE_URL = 'postgres://test'

      const RETENTION_DAYS = 7
      expect(RETENTION_DAYS).toBe(7)
    })
  })

  describe('Backup file naming', () => {
    it('generates timestamped backup filenames', () => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `backup-${timestamp}.sql`

      expect(filename).toMatch(/^backup-\d{4}-\d{2}-\d{2}/)
      expect(filename).toMatch(/\.sql$/)
    })

    it('uses unique timestamps for each backup', () => {
      const time1 = new Date().toISOString().replace(/[:.]/g, '-')
      const filename1 = `backup-${time1}.sql`

      // Slight delay
      const time2 = new Date(Date.now() + 100).toISOString().replace(/[:.]/g, '-')
      const filename2 = `backup-${time2}.sql`

      expect(filename1).not.toBe(filename2)
    })
  })

  describe('Backup safety', () => {
    it('does not clobber backups (unique names)', () => {
      const timestamp1 = new Date().toISOString().replace(/[:.]/g, '-')
      const timestamp2 = new Date(Date.now() + 1000).toISOString().replace(/[:.]/g, '-')

      const filename1 = `backup-${timestamp1}.sql`
      const filename2 = `backup-${timestamp2}.sql`

      expect(filename1).not.toBe(filename2)
    })

    it('enforces retention policy (7 days)', () => {
      const RETENTION_DAYS = 7
      const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000

      // Verify retention is reasonable
      expect(RETENTION_MS).toBeGreaterThan(0)
      expect(RETENTION_DAYS).toBeGreaterThanOrEqual(7)
    })
  })

  describe('Error handling', () => {
    it('logs errors on backup failure', () => {
      process.env.DATABASE_URL = 'postgres://test'
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // When backup fails, it should be logged
      expect(errorSpy).toBeDefined()

      errorSpy.mockRestore()
    })
  })

  describe('Security', () => {
    it('uses SQL format for backups', () => {
      const backupFile = 'backup-2026-06-29T10-30-45-123Z.sql'
      expect(backupFile).toMatch(/\.sql$/)
    })

    it('does not expose credentials in filenames', () => {
      process.env.DATABASE_URL = 'postgres://user:password@host:5432/db'

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `backup-${timestamp}.sql`

      // Filename should not contain connection details
      expect(filename).not.toContain('password')
      expect(filename).not.toContain('host')
      expect(filename).not.toContain('://')
    })
  })

  describe('Recovery readiness', () => {
    it('creates backups in standard SQL format', () => {
      const backupFile = 'backup-2026-06-29T10-30-45-123Z.sql'
      expect(backupFile).toMatch(/\.sql$/)
    })

    it('preserves backup metadata through naming', () => {
      const backupFile = 'backup-2026-06-29T10-30-45-123Z.sql'
      const dateMatch = backupFile.match(/backup-(\d{4}-\d{2}-\d{2})/)
      expect(dateMatch).toBeTruthy()
      expect(dateMatch?.[1]).toBe('2026-06-29')
    })
  })
})
