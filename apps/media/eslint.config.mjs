import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'error',
      // Logging policy (docs/operations/logging.md): production code logs through the logger, never console.log/info/debug
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The container's job server runs on Node 22 (container/Dockerfile)
    files: ['container/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', fetch: 'readonly', URL: 'readonly' } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/__tests__/**', '**/*.test.ts', 'test/**', 'scripts/**'],
    rules: { 'no-console': 'off' },
  }
);
