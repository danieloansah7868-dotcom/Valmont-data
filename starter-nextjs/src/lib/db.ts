import { Pool, type QueryResult, type QueryResultRow } from "pg";
import fs from "fs";
import path from "path";

const globalForDb = globalThis as unknown as { __vdPool?: Pool };

async function createPool(): Promise<Pool> {
  // Zero-config mode: run the whole app against an in-memory Postgres emulator.
  // Set MEMORY_DB=1 and skip Postgres entirely (schema.sql is auto-applied).
  // NOTE: for local/production use, remove MEMORY_DB and set DATABASE_URL instead.
  if (process.env.MEMORY_DB === "1") {
    const { newDb } = await import("pg-mem");
    const memDb = newDb();
    const sql = fs.readFileSync(path.join(process.cwd(), "schema.sql"), "utf8");
    memDb.public.none(sql);
    const { Pool: MemPool } = memDb.adapters.createPg();
    return new MemPool() as unknown as Pool;
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
}

// Cache the pool on globalThis, not just module scope: Next.js dev mode can
// evaluate route modules in separate graphs, and without the cache each graph
// would create its OWN pool. Harmless with real Postgres (same server behind
// it), but fatal with MEMORY_DB=1 — every route would get its own private
// in-memory database (signup in one, orders in another) and smoke.sh fails
// cold with inexplicable 404/401s.
export const pool: Pool = globalForDb.__vdPool ?? (await createPool());

if (process.env.NODE_ENV !== "production") globalForDb.__vdPool = pool;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  try {
    return await pool.query<T>(text, params);
  } catch (err) {
    // Surface a friendly message when the DB hasn't been set up yet
    if (
      err instanceof Error &&
      (err.message.includes("does not exist") || err.message.includes("connect ECONNREFUSED"))
    ) {
      throw new Error(
        "Database is not ready. Either set MEMORY_DB=1 for the zero-config in-memory mode, " +
          "or copy .env.example to .env.local, set DATABASE_URL, then run: npm run db:migrate"
      );
    }
    throw err;
  }
}
