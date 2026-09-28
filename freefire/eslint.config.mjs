// Lint config for the browser-facing sources. Catches typos like using an
// identifier that was never imported (the bug class that broke endMatch()).
import globals from 'globals';

export default [
  {
    files: ['src/**/*.js', 'sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.worker,
        GAME: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-const-assign': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-unreachable': 'error',
      'no-cond-assign': 'error',
      'no-constant-condition': 'warn',
      'no-empty': 'warn',
      'no-fallthrough': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-loss-of-precision': 'error',
      'no-sparse-arrays': 'error',
      'no-useless-escape': 'warn',
      'no-prototype-builtins': 'warn',
      'no-irregular-whitespace': 'error',
      'no-misleading-character-class': 'error',
      'require-atomic-updates': 'off',
    },
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }] },
  },
];
