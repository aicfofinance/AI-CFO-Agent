import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";

import * as schema from "./schema";

/**
 * Drizzle database clients.
 *
 * Two connections exist and they are NOT interchangeable:
 *
 * - `db` (this is what application code uses) connects through the Supabase
 *   pooler on port 6543. PgBouncer runs in transaction pooling mode, which does
 *   not support PostgreSQL prepared statements, so `prepare: false` is required.
 *   Every API route, background job, and financial query uses `db`.
 *
 * - `dbDirect` connects directly on port 5432 and is reserved for migrations
 *   ONLY (drizzle-kit / migration scripts). It must never be imported in an API
 *   route or a background job — the direct connection is not pooled and will
 *   exhaust the database's connection limit under load. Supabase requires TLS on
 *   the direct connection, hence `ssl: "require"`.
 *
 * Both clients are schema-aware (the schema is passed in) so the Drizzle query
 * builder can infer row and relation types.
 */

const poolerClient = postgres(env.DATABASE_URL, { prepare: false });
const directClient = postgres(env.DATABASE_URL_DIRECT, { ssl: "require" });

export const db = drizzle(poolerClient, { schema });

export const dbDirect = drizzle(directClient, { schema });
