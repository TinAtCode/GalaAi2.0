module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  settings: { react: { version: 'detect' } },
  root: true,
  env: { browser: true, es2021: true },
  ignorePatterns: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/'],
  rules: {
    'react/react-in-jsx-scope': 'off', // Vite-JSX-Runtime, kein React-Import nötig
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
};
