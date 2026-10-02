/**
 * Database adapter.
 * Uses PostgreSQL when DATABASE_URL is configured and embedded PGlite otherwise.
 * PGlite is dynamically imported so its WASM runtime is never evaluated while
 * Next.js is collecting routes/static paths during a production build.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { drizzle as drizzleNode, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { BOOTSTRAP_SQL } from "./bootstrap";

type AppDb = NodePgDatabase<typeof schema>;
type DbState = { db: AppDb; pool: Pool | null; embedded: boolean };
const g = globalThis as typeof globalThis & { __voxDbState?: Promise<DbState> };

async function initialise(): Promise<DbState> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    return { db: drizzleNode(pool, { schema }), pool, embedded: false };
  }

  // Next evaluates route modules while collecting build metadata. Importing PGlite in
  // that worker starts Emscripten/WASM and can abort before Next reads route exports.
  // A disconnected PostgreSQL adapter is sufficient during that metadata-only phase;
  // route handlers are not executed there.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    const pool = new Pool({
      connectionString: "postgresql://build:build@127.0.0.1:1/build",
      connectionTimeoutMillis: 100,
    });
    return { db: drizzleNode(pool, { schema }), pool, embedded: false };
  }

  const [{ PGlite }, { drizzle: drizzlePglite }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);
  const root = path.resolve(process.env.STORAGE_DIR ?? "./storage");
  const dir = path.join(root, "pglite");
  await fs.mkdir(dir, { recursive: true });
  const client = new PGlite(`file://${dir}`);
  await client.exec(BOOTSTRAP_SQL);
  const db = drizzlePglite(client, { schema }) as unknown as AppDb;
  console.info(`[db] DATABASE_URL is not set; using embedded PGlite at ${dir}`);
  return { db, pool: null, embedded: true };
}

const state = await (g.__voxDbState ??= initialise());
export const db = state.db;
export const pool = state.pool;
export const usingEmbeddedDatabase = state.embedded;
