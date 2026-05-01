/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@infrastructure/(.*)$': '<rootDir>/src/infrastructure/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1'
  },
  collectCoverageFrom: [
    'src/modules/quest/**/*.ts',
    'src/modules/resolver/application/quest-bridge.ts',
    'src/modules/resolver/application/correlate-action.usecase.ts',
    'src/modules/memory/interfaces/memory.controller.ts'
  ],
  coverageThreshold: {
    'src/modules/quest/domain/': {
      statements: 70, branches: 60, functions: 70, lines: 70
    }
  }
};

