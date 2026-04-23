import path from 'node:path';

import { newDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../src/infrastructure/logging/logger';
import {
  loadMigrationsFromDir,
  resolveMigrationsDir,
  runMigrations,
} from '../src/infrastructure/db/migrator';

describe('migrator', () => {
  it('loads migrations sorted by filename', async () => {
    const migrations = await loadMigrationsFromDir(resolveMigrationsDir());
    expect(migrations.length).toBeGreaterThan(0);

    const filenames = migrations.map((migration) => migration.filename);
    const sorted = [...filenames].sort((a, b) => a.localeCompare(b));
    expect(filenames).toEqual(sorted);
  });

  it('applies pending migrations and skips already applied ones', async () => {
    const db = newDb({ noAstCoverageCheck: true });
    const pgAdapter = db.adapters.createPg();
    const pool = new pgAdapter.Pool();
    const logger = createLogger({ level: 'silent', nodeEnv: 'test' });

    const migrationsDir = path.resolve(process.cwd(), 'migrations');

    const firstRun = await runMigrations(pool, logger, migrationsDir);
    expect(firstRun.applied.length).toBeGreaterThan(0);

    const secondRun = await runMigrations(pool, logger, migrationsDir);
    expect(secondRun.applied).toEqual([]);
    expect(secondRun.skipped.length).toBe(firstRun.applied.length);

    await pool.end();
  });
});
