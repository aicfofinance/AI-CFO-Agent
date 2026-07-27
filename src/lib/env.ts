import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Build-time and runtime environment variable validation.
 *
 * This is the ONLY file in the codebase permitted to read `process.env`
 * directly (enforced by the ESLint `no-restricted-syntax` rule). Every other
 * module imports the typed, validated `env` object from `@/lib/env`.
 *
 * Validation runs at build time because `next.config.ts` imports this module
 * as a side effect. A missing day-one variable therefore fails `pnpm build`.
 *
 * Adding a new variable: add it to `server`/`client`, add the matching entry
 * to `runtimeEnv`, and document it in `.env.example`. Variables that are not
 * yet consumed at runtime start as `.optional()` and are promoted to required
 * in the step that first depends on them.
 */
export const env = createEnv({
  server: {
    // --- Day-one required ---
    DATABASE_URL: z.string().url(),
    DATABASE_URL_DIRECT: z.string().url(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    // AES-256-GCM key: 32 bytes rendered as 64 hex characters.
    OAUTH_ENCRYPTION_KEY: z.string().min(64),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // --- QuickBooks (optional until Phase 4) ---
    QB_CLIENT_ID: z.string().min(1).optional(),
    QB_CLIENT_SECRET: z.string().min(1).optional(),
    QB_ENVIRONMENT: z.enum(["sandbox", "production"]).optional(),

    // --- Xero (optional until Phase 12) ---
    XERO_CLIENT_ID: z.string().min(1).optional(),
    XERO_CLIENT_SECRET: z.string().min(1).optional(),

    // --- AI providers (optional — either one works) ---
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    GOOGLE_AI_API_KEY: z.string().min(1).optional(),
    AI_PROVIDER: z.enum(["anthropic", "google"]).optional(),

    // --- Inngest (optional until Step 1.7) ---
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    INNGEST_EVENT_KEY: z.string().min(1).optional(),

    // --- Stripe (optional until Phase 13) ---
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

    // --- Upstash Redis (optional until Step 11.3) ---
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

    // --- Resend (optional until Phase 2) ---
    RESEND_API_KEY: z.string().min(1).optional(),
    FROM_EMAIL: z.string().email().optional(),
  },
  client: {
    // Canonical application URL. Prefixed `NEXT_PUBLIC_` so it is readable on
    // both the server (OAuth redirects, email links) and the client. Kept
    // optional until a runtime consumer exists (magic-link callback / OAuth).
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_DIRECT: process.env.DATABASE_URL_DIRECT,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    OAUTH_ENCRYPTION_KEY: process.env.OAUTH_ENCRYPTION_KEY,
    NODE_ENV: process.env.NODE_ENV,
    QB_CLIENT_ID: process.env.QB_CLIENT_ID,
    QB_CLIENT_SECRET: process.env.QB_CLIENT_SECRET,
    QB_ENVIRONMENT: process.env.QB_ENVIRONMENT,
    XERO_CLIENT_ID: process.env.XERO_CLIENT_ID,
    XERO_CLIENT_SECRET: process.env.XERO_CLIENT_SECRET,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    FROM_EMAIL: process.env.FROM_EMAIL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  /**
   * Treat empty strings as undefined. `.env.example` ships optional keys with
   * empty values (e.g. `QB_CLIENT_ID=`); when copied to `.env.local`, those
   * would otherwise fail `.min(1)`. This keeps a fresh clone building.
   */
  emptyStringAsUndefined: true,
});
