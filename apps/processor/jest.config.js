module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/__tests__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^@al-ummah/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@al-ummah/logger$': '<rootDir>/../../packages/logger/src/index.ts',
    // the logger's sources import siblings as './x.js' (ESM output); jest loads the .ts
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@al-ummah)/)',
  ],
};