// Lint for the logging policy only (docs/operations/logging.md): production code
// logs through the logger (src/lib/logger.ts), never console.log/info/debug.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', '.wrangler/**', 'worker-configuration.d.ts', 'test/**', 'scripts/**', '**/*.spec.ts', '**/*.test.ts', '**/__tests__/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
);
