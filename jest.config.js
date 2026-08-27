const path = require('node:path');

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
    // `web` reaches its own modules through the `@/` alias it declares in
    // vite.config.ts and tsconfig.json; jest resolves neither, so it needs the same
    // mapping here or a web test cannot import the module it is testing.
    '^@/(.*)$': '<rootDir>/packages/web/src/$1',
  },
  transform: {
    // `paths` mirrors the moduleNameMapper above: the mapper only tells jest where to
    // load `@/…` from at runtime, and without the compiler knowing the same thing a
    // web test fails to typecheck before it ever runs.
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'es2022',
          esModuleInterop: true,
          strict: true,
          baseUrl: __dirname,
          paths: { '@/*': [path.join(__dirname, 'packages/web/src/*')] },
        },
      },
    ],
  },
  collectCoverageFrom: ['packages/*/src/**/*.ts', '!packages/*/src/**/index.ts'],
};
