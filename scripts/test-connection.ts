import "./load-env";

import postgres from "postgres";

import { env } from "@/lib/env";

/**
 * Database connectivity smoke test (IMPLEMENTATION_PLAN Step 1.5).
 *
 * Opens a single direct connection to Postgres and prints the server version.
 * Run with: `pnpm tsx scripts/test-connection.ts`.
 *
 * Uses `DATABASE_URL_DIRECT` (port 5432) because scripts are development
 * utilities, not application code — the pooled `db` client is reserved for the
 * app. Supabase requires TLS, hence `ssl: "require"`.
 */
async function main(): Promise<void> {
  const sql = postgres(env.DATABASE_URL_DIRECT, { ssl: "require" });

  try {
    const rows = await sql<{ version: string }[]>`SELECT version()`;
    console.log(rows[0]?.version);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
