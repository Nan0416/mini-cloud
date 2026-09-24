const path = require('node:path');

/** Workspace packages a test may import, resolved to source so `npm test` needs no build. */
const SOURCE_PACKAGES = ['shared', 'client', 'reporter', 'agent', 'service'];

/** Dependencies published only as ES modules, as one regex group. */
const ESM_ONLY_PACKAGES = '(commander|d3-[^/]+|internmap)';

/**
 * Root jest config — runs unit tests across every workspace package.
 *
 * Tests live in `packages/<pkg>/tests/`, mirroring that package's `src/` directory:
 * `src/data/pg-agent-dao.ts` is tested by `tests/data/pg-agent-dao.test.ts`. The
 * mirror is the index — finding the tests for a file never involves a search, and a
 * directory with no counterpart under `tests/` is visibly untested.
 *
 * `tests/data-integration/` is the one deliberate exception: it holds suites that
 * need a real PostgreSQL and skip themselves without one, kept apart so a directory
 * listing says which tests always run.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  // `?(x)` so a future component test can be `.test.tsx`. Anything else under
  // `tests/` — fixtures, fakes, helpers such as `tests/data/test-helpers.ts` — is not
  // a suite and is simply not matched.
  testMatch: ['**/tests/**/*.test.ts?(x)'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    ...Object.fromEntries(SOURCE_PACKAGES.map((name) => [`^@mini-cloud/${name}$`, `<rootDir>/packages/${name}/src`])),
    // `web` reaches its own modules through the `@/` alias it declares in
    // vite.config.ts and tsconfig.json; jest resolves neither, so it needs the same
    // mapping here or a web test cannot import the module it is testing.
    '^@/(.*)$': '<rootDir>/packages/web/src/$1',
  },
  transform: {
    // `.tsx` as well as `.ts`, with `jsx` set: `web` is half TSX, and a `.ts` module
    // that imports a `.tsx` one — every hook that touches `use-connection` — fails to
    // compile without both. That surfaced only as "failed to collect coverage from",
    // which is easy to read as a coverage problem rather than a config one.
    //
    // `paths` mirrors the moduleNameMapper above: the mapper only tells jest where to
    // load a module from at runtime. Without the compiler knowing the same thing, a web
    // test fails to typecheck, and every `@mini-cloud/*` import typechecks against a
    // `dist` that a fresh clone does not have — or a stale one that it does.
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'es2022',
          jsx: 'react-jsx',
          lib: ['es2022', 'dom'],
          esModuleInterop: true,
          strict: true,
          baseUrl: __dirname,
          paths: {
            '@/*': [path.join(__dirname, 'packages/web/src/*')],
            ...Object.fromEntries(SOURCE_PACKAGES.map((name) => [`@mini-cloud/${name}`, [path.join(__dirname, `packages/${name}/src`)]])),
          },
        },
      },
    ],
    // commander and d3 ship ESM only, which jest's CommonJS runtime cannot load.
    // Compiled here, a test can drive the real command tree rather than a copy of its
    // wiring, and the console's chart arithmetic runs on the d3 it ships with.
    // `internmap` is d3-array's own ESM-only dependency.
    [`/node_modules/${ESM_ONLY_PACKAGES}/.+\\.js$`]: ['ts-jest', { tsconfig: { module: 'commonjs', target: 'es2022', allowJs: true } }],
  },
  transformIgnorePatterns: [`/node_modules/(?!${ESM_ONLY_PACKAGES}/)`],
  collectCoverageFrom: [
    'packages/*/src/**/*.ts',
    'packages/*/src/**/*.tsx',
    // Barrels are re-exports with no behaviour of their own; counting them inflates
    // the number without anything being tested.
    '!packages/*/src/**/index.ts',
  ],
};
