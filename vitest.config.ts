import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Vitest configuration.
 *
 * Mirrors the `@/*` path aliases from `tsconfig.json` so tests can import
 * application modules the same way source files do. Vitest does not read
 * `tsconfig` paths on its own, so the alias is declared explicitly here.
 */
const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const jobsDir = fileURLToPath(new URL("./jobs", import.meta.url));

export default defineConfig({
  // Override PostCSS config discovery so Vitest does not try to load the
  // Tailwind v4 `postcss.config.mjs` (irrelevant to Node-environment tests and
  // incompatible with Vite's PostCSS loader).
  css: {
    postcss: { plugins: [] },
  },
  resolve: {
    // Mirror both tsconfig aliases: `@/jobs/*` → `./jobs/*` (Inngest functions live
    // outside `src/`) MUST be matched before the general `@/*` → `./src/*` rule, as
    // Vite resolves alias entries in order and takes the first match.
    alias: [
      { find: /^@\/jobs\//, replacement: `${jobsDir}/` },
      { find: /^@\//, replacement: `${srcDir}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
