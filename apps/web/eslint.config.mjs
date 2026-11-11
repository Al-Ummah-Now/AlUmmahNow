import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "test-results-player/**",
      "playwright-report-player/**",
      // HLS fixtures: .ts here are MPEG transport stream segments, not TypeScript
      "e2e/player/fixtures/**",
      "jest.config.js",
      "tailwind.config.ts",
      "public/**",
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // Allow unused variables/parameters prefixed with underscore
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // E2E specs are Playwright, not React: fixtures call `use(...)` and the own-data builders are
    // `useOwnData(test)` at a spec's top level, which the React hooks rule misreads as hooks
    files: ["e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    // Logging policy (docs/operations/logging.md): production code logs through the logger, never console.log/info/debug
    files: ["src/**/*.{ts,tsx}", "worker.ts"],
    ignores: ["**/__tests__/**", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "src/test/**"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // No browser prompts (owner rule): use the in-app confirm dialog
    // (src/components/ui/confirm-dialog.tsx) and inline errors; never beforeunload
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    rules: {
      "no-alert": "error",
      "no-restricted-globals": [
        "error",
        { name: "alert", message: "Show an inline error or status instead of a browser alert." },
        { name: "confirm", message: "Use the in-app confirm dialog (src/components/ui/confirm-dialog.tsx)." },
        { name: "prompt", message: "Use an in-app dialog with an input." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value='beforeunload']",
          message: "No beforeunload: guard in-app links with the leave dialog, flush telemetry on pagehide.",
        },
      ],
    },
  },
  {
    // Links prefetch on intent, not on sight (Cloudflare usage, 2026-11-11): import
    // Link from the wrapper (src/components/common/AppLink.tsx), never next/link
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/common/AppLink.tsx", "**/__tests__/**", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "next/link", message: "Import Link from '@/components/common/AppLink': it prefetches on hover/focus instead of whenever the link is visible." }] },
      ],
    },
  },
];

export default eslintConfig;
