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

export default defineConfig({
  // Override PostCSS config discovery so Vitest does not try to load the
  // Tailwind v4 `postcss.config.mjs` (irrelevant to Node-environment tests and
  // incompatible with Vite's PostCSS loader).
  css: {
    postcss: { plugins: [] },
  },
  resolve: {
    alias: [{ find: /^@\//, replacement: `${srcDir}/` }],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
