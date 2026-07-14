import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { Pool } from 'pg'

const DB_CONNECT_RETRIES = parseInt(process.env.DB_CONNECT_RETRIES ?? '5', 10)
const DB_CONNECT_RETRY_MS = parseInt(process.env.DB_CONNECT_RETRY_MS ?? '2000', 10)

// Splits a SQL file into individual statements, respecting single/double-quoted
// strings, dollar-quoted bodies ($$...$$ or $tag$...$tag$), and line comments so
// semicolons inside them aren't treated as statement boundaries.
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let i = 0
  let dollarTag: string | null = null

  while (i < sql.length) {
    const rest = sql.slice(i)

    if (dollarTag) {
      const closeIdx = rest.indexOf(dollarTag)
      if (closeIdx === -1) {
        current += rest
        i = sql.length
      } else {
        current += rest.slice(0, closeIdx + dollarTag.length)
        i += closeIdx + dollarTag.length
        dollarTag = null
      }
      continue
    }

    const dollarMatch = /^\$[A-Za-z_]*\$/.exec(rest)
    if (dollarMatch) {
      dollarTag = dollarMatch[0]
      current += dollarTag
      i += dollarTag.length
      continue
    }

    const ch = sql[i]

    if (ch === '-' && sql[i + 1] === '-') {
      const nlIdx = sql.indexOf('\n', i)
      const end = nlIdx === -1 ? sql.length : nlIdx + 1
      current += sql.slice(i, end)
      i = end
      continue
    }

    if (ch === "'" || ch === '"') {
      const quote = ch
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) {
            j += 2
            continue
          }
          j += 1
          break
        }
        j += 1
      }
      current += sql.slice(i, j)
      i = j
      continue
    }

    if (ch === ';') {
      current += ch
      const trimmed = current.trim()
      if (trimmed) statements.push(trimmed)
      current = ''
      i += 1
      continue
    }

    current += ch
    i += 1
  }

  const trimmed = current.trim()
  if (trimmed) statements.push(trimmed)

  return statements
}

async function connectWithRetry(databaseUrl: string): Promise<Pool> {
  for (let attempt = 1; attempt <= DB_CONNECT_RETRIES; attempt++) {
    try {
      const pool = new Pool({ connectionString: databaseUrl })
      await pool.query('SELECT 1')
      if (attempt > 1) {
        console.log(`[migrations] Connected on attempt ${attempt}`)
      }
      return pool
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[migrations] Connection attempt ${attempt}/${DB_CONNECT_RETRIES} failed: ${message}`,
      )

      if (attempt >= DB_CONNECT_RETRIES) {
        throw new Error(
          `Failed to connect to database after ${DB_CONNECT_RETRIES} attempts`,
        )
      }

      const delay = DB_CONNECT_RETRY_MS * Math.pow(2, attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error('Exhausted retries')
}

export async function runMigrationsIfNeeded() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return

  const pool = await connectWithRetry(databaseUrl)

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

      // CREATE INDEX CONCURRENTLY is rejected by Postgres inside any transaction
      // block, including the implicit one formed by sending multiple statements
      // in a single query. Such migrations must run statement-by-statement with
      // no surrounding BEGIN/COMMIT.
      if (/CONCURRENTLY/i.test(sql)) {
        for (const statement of splitSqlStatements(sql)) {
          await pool.query(statement)
        }
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        console.log(`[migrations] Applied: ${file}`)
        continue
      }

      await pool.query('BEGIN')
      try {
        await pool.query(sql)
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        await pool.query('COMMIT')
        console.log(`[migrations] Applied: ${file}`)
      } catch (error) {
        await pool.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await pool.end()
  }
}
