import type { Logger } from 'pino';

import { assertCommandEnv, type AppEnv } from '../../infrastructure/config/env';
import { createPostgresPool } from '../../infrastructure/db/connection';
import { resolveMigrationsDir, runMigrations } from '../../infrastructure/db/migrator';

export async function runMigrate(env: AppEnv, logger: Logger): Promise<number> {
  assertCommandEnv(env, 'migrate');
  const pool = createPostgresPool(env);
  const migrationsDir = resolveMigrationsDir();

  try {
    const report = await runMigrations(pool, logger, migrationsDir);
    logger.info(
      {
        command: 'migrate',
        appliedMigrations: report.applied,
        skippedMigrations: report.skipped,
      },
      'Database migrations completed',
    );
    return 0;
  } finally {
    await pool.end();
  }
}
