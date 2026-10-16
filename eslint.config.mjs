import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['src/generated/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: { import: importPlugin },
    settings: { 'import/resolver': { typescript: {} } },
    rules: {
      'import/no-restricted-paths': ['error', {
        zones: [
          { target: './src/domain', from: './src/server', message: 'domain must not import server' },
          { target: './src/domain', from: './src/app', message: 'domain must not import app' },
          { target: './src/server', from: './src/app', message: 'server must not import app' },
        ],
      }],
    },
  },
  {
    // A key written after a spread makes the JSX runtime fall back to createElement,
    // and React 19 then reports the list as unkeyed (seen on every Movimientos and
    // Actividad render). Keys go first.
    files: ['src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "JSXOpeningElement > JSXSpreadAttribute ~ JSXAttribute[name.name='key']",
        message: 'Put `key` before any {...spread} props.',
      }],
    },
  },
  {
    // Specs go through e2e/support.ts: each test is its own client of the rate-limited
    // server, and a page is used only once React has hydrated it.
    files: ['e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@playwright/test',
          importNames: ['test'],
          message: 'Import `test` from ./support (one client address per test).',
        }],
      }],
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.property.name='goto']",
          message: 'Use gotoHydrated(page, url) from ./support.',
        },
        {
          selector: "CallExpression[callee.object.name='browser'][callee.property.name='newContext']",
          message: 'Use newClient(browser) from ./support.',
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['next', 'next/*', 'react', 'react-dom', 'react-dom/*', '@prisma/*', 'node:*', 'zod'],
          message: 'src/domain is pure TypeScript: no framework, ORM, or Node imports',
        }],
      }],
    },
  },
];
