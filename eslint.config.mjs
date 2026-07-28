import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // SECURITY: environment variables must only be read through the validated
      // `env` object in src/lib/env.ts. Forbid every form of direct process.env access.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'MemberExpression[object.name="process"][property.name="env"]',
          message:
            "Direct process.env access is forbidden. Import the validated, typed `env` object from `@/lib/env` instead.",
        },
      ],
      // SECURITY (CRITICAL): AI providers may only be selected inside the model
      // router. Every other file must call getModel() from @/lib/ai/models/router.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@ai-sdk/anthropic",
              message:
                "Do not import @ai-sdk/anthropic directly. Model access must go through getModel() in @/lib/ai/models/router.",
            },
            {
              name: "@ai-sdk/google",
              message:
                "Do not import @ai-sdk/google directly. Model access must go through getModel() in @/lib/ai/models/router.",
            },
          ],
        },
      ],
    },
  },
  // Exception: the model router is the ONLY file permitted to import AI SDK providers.
  {
    files: ["src/lib/ai/models/router.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // Exception: env.ts is the ONLY file permitted to read process.env; it validates
  // the raw values and re-exports them as the typed `env` object the rest of the app uses.
  {
    files: ["src/lib/env.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  // Exception: drizzle.config.ts is a drizzle-kit tool config, not application code.
  // It runs outside Next.js and cannot use the T3 env schema.
  {
    files: ["drizzle.config.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];

export default eslintConfig;
