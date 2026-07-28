/**
 * Loads `.env.local` into the process environment for standalone script runs.
 *
 * Next.js loads `.env.local` automatically; scripts executed with `tsx` do not.
 * `@/lib/env` validates the environment at import time, so the variables must
 * be present BEFORE that module is evaluated. This loader lives in its own file
 * and is imported first (see `test-connection.ts`) so ES module evaluation
 * order guarantees it runs before `@/lib/env`.
 *
 * `process.loadEnvFile` (Node 20.12+) is used instead of `process.env` writes,
 * keeping this file compliant with the `no-restricted-syntax` rule that forbids
 * direct `process.env` access outside `src/lib/env.ts`.
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  // `.env.local` is optional when the variables already exist in the ambient
  // environment (e.g. CI). `@/lib/env` surfaces any genuinely missing variable
  // with a clear validation error when it is evaluated.
}

export {};
