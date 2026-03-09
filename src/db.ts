export type PgClientLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>
  release: () => void
}

export type PgPoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>
  connect: () => Promise<PgClientLike>
}

let pool: PgPoolLike | null = null

export function setPool(newPool: PgPoolLike | null) {
  pool = newPool
}

export async function getPool(): Promise<PgPoolLike | null> {
  if (pool) return pool
  if (!process.env.DATABASE_URL) return null

  try {
    const mod = await import('pg')
    const PgPool = (mod as any).Pool
    pool = new PgPool({
      connectionString: process.env.DATABASE_URL,
    })
    return pool
  } catch {
    return null
  }
}