import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit CLI configuration.
 *
 * This file is read by the drizzle-kit CLI (db:generate / db:migrate /
 * db:studio), NOT by Next.js. It therefore cannot import the T3 `env` schema
 * from `@/lib/env`, which pulls in Next.js internals. Reading `process.env`
 * directly here is the one sanctioned exception (mirrored in eslint.config.mjs).
 *
 * Migrations run against the DIRECT connection (port 5432), never the pooler —
 * schema DDL requires a session-mode connection.
 */

// Load `.env.local` for local CLI runs. In CI the variables are injected as
// ambient env vars and no `.env.local` exists, so a missing file is a no-op.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No `.env.local` present — rely on ambient environment variables.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/platform/db/schema.ts",
  out: "./src/lib/platform/db/migrations",
  dbCredentials: {
    url: process.env["DATABASE_URL_DIRECT"]!,
  },
});
