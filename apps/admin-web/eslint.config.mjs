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
      "node_modules/**",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
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
    // (useConfirm / ConfirmDialog in src/components/content/actions.tsx) and inline errors; never beforeunload
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    rules: {
      "no-alert": "error",
      "no-restricted-globals": [
        "error",
        { name: "alert", message: "Show an inline error or status instead of a browser alert." },
        { name: "confirm", message: "Use the in-app confirm dialog (useConfirm / ConfirmDialog in src/components/content/actions.tsx)." },
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
    // Link from the wrapper (src/components/AppLink.tsx), never next/link
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/AppLink.tsx", "**/__tests__/**", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "next/link", message: "Import Link from '@/components/AppLink': it prefetches on hover/focus instead of whenever the link is visible." }] },
      ],
    },
  },
];

export default eslintConfig;
