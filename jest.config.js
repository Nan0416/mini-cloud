/** Root jest config — runs unit tests across every workspace package. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: ['**/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@mini-cloud/shared$': '<rootDir>/packages/shared/src',
    '^@mini-cloud/client$': '<rootDir>/packages/client/src',
    '^@mini-cloud/reporter$': '<rootDir>/packages/reporter/src',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', target: 'es2022', esModuleInterop: true, strict: true } }],
  },
  collectCoverageFrom: ['packages/*/src/**/*.ts', '!packages/*/src/**/index.ts'],
};
