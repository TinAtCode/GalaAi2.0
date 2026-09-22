// Integrationstests gegen eine ECHTE PostgreSQL (DATABASE_URL). Anders als
// die Unit-Tests (gemockter Prisma-Client) fallen hier auch Fehler im Schema,
// in den Relationen und in den tatsächlichen SQL-Abfragen auf.
// Aufruf: DATABASE_URL=... npm run test:integration (Datenbank wird geleert!)
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/integration/.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  setupFiles: ['<rootDir>/test/integration/env.ts'],
  testEnvironment: 'node',
  // Alle Suites teilen sich eine Datenbank und leeren sie – nacheinander laufen.
  maxWorkers: 1,
  testTimeout: 30000,
};
