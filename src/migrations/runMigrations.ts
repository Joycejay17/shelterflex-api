import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { Pool } from 'pg'

export async function runMigrationsIfNeeded() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return

  const pool = new Pool({ connectionString: databaseUrl })

  const migrationsDir = path.resolve(process.cwd(), 'migrations')

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b))

    for (const file of files) {
      const alreadyApplied = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file],
      )

      if (alreadyApplied.rowCount) continue

      const sql = await readFile(path.join(migrationsDir, file), 'utf8')

      await pool.query('BEGIN')
      try {
        await pool.query(sql)
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        await pool.query('COMMIT')
      } catch (error) {
        await pool.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await pool.end()
  }
}
