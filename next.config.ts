import type { NextConfig } from "next";

// Validate environment variables at build time. Importing the env module for
// its side effect runs `createEnv()`, so `pnpm build` fails fast if a required
// variable is missing. A relative path is required here because the `@/`
// tsconfig alias is not resolved while Next.js loads this config file.
import "./src/lib/env";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
