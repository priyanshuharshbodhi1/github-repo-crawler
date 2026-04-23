import type { Logger } from 'pino';

import { exportRepositoriesToJson, exportUiDataset } from '../export/export-service';
import { assertCommandEnv, type AppEnv } from '../../infrastructure/config/env';
import { createPostgresPool } from '../../infrastructure/db/connection';
import { resolveMigrationsDir, runMigrations } from '../../infrastructure/db/migrator';

export async function runExport(env: AppEnv, logger: Logger): Promise<number> {
  assertCommandEnv(env, 'export');
  const pool = createPostgresPool(env);

  try {
    await runMigrations(pool, logger, resolveMigrationsDir());
    await exportRepositoriesToJson({
      pool,
      outputPath: env.EXPORT_PATH,
      logger,
    });
    await exportUiDataset({
      pool,
      outputPath: env.UI_DATASET_PATH,
      logger,
      limit: env.UI_TOP_REPOSITORIES_LIMIT,
    });
    return 0;
  } finally {
    await pool.end();
  }
}
