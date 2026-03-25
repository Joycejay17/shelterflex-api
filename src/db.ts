export type PgClientLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>
  release: () => void
}

export type PgPoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>
  connect: () => Promise<PgClientLike>
}

let pool: PgPoolLike | null = null

const DB_CONNECT_RETRIES = parseInt(process.env.DB_CONNECT_RETRIES ?? '5', 10)
const DB_CONNECT_RETRY_MS = parseInt(process.env.DB_CONNECT_RETRY_MS ?? '2000', 10)

export function setPool(newPool: PgPoolLike | null) {
  pool = newPool
}

export async function getPool(): Promise<PgPoolLike | null> {
  if (pool) return pool
  if (!process.env.DATABASE_URL) return null

  for (let attempt = 1; attempt <= DB_CONNECT_RETRIES; attempt++) {
    try {
      const mod = await import('pg')
      const PgPool = (mod as any).Pool
      const candidate = new PgPool({
        connectionString: process.env.DATABASE_URL,
      })

      // Verify the connection is actually usable
      await candidate.query('SELECT 1')
      pool = candidate
      if (attempt > 1) {
        console.log(`[db] Connected on attempt ${attempt}`)
      }
      return pool
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[db] Connection attempt ${attempt}/${DB_CONNECT_RETRIES} failed: ${message}`,
      )

      if (attempt < DB_CONNECT_RETRIES) {
        const delay = DB_CONNECT_RETRY_MS * Math.pow(2, attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  console.error(`[db] All ${DB_CONNECT_RETRIES} connection attempts failed`)
  return null
}
