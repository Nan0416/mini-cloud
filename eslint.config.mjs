import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Guideline: never cast with `as` — use the assertion helpers in @mini-cloud/shared.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      // Guideline: always brace `if` bodies.
      curly: ['error', 'all'],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    // The logger and assertion helpers are the sanctioned boundary where casting is unavoidable.
    files: ['packages/shared/src/utils/assertions.ts', 'packages/shared/src/utils/logger.ts'],
    rules: { '@typescript-eslint/consistent-type-assertions': 'off' },
  },
  {
    // Every API method takes one Request and returns one Response, and every DAO
    // method one Input and one Output, even when the payload is empty. `{}` is the
    // point: it names the contract and gives the shape somewhere to grow, so an
    // endpoint or query gaining a field is not a breaking signature change for every
    // caller.
    files: ['packages/shared/src/api/*.ts', 'packages/service/src/data/*-dao.ts'],
    rules: { '@typescript-eslint/no-empty-object-type': 'off' },
  },
  {
    // The web console runs in a browser, not in Node, and the rules of hooks are the
    // one class of React mistake that fails silently at runtime rather than at build.
    files: ['packages/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
