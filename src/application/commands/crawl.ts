import type { Logger } from 'pino';

import { CrawlerService } from '../crawler/crawler-service';
import { assertCommandEnv, type AppEnv } from '../../infrastructure/config/env';
import { createPostgresPool } from '../../infrastructure/db/connection';
import { resolveMigrationsDir, runMigrations } from '../../infrastructure/db/migrator';
import { PostgresRepositoryStore } from '../../infrastructure/db/postgres-repository-store';
import { GithubGraphqlClient } from '../../infrastructure/github/graphql-client';
import { writeJsonFile } from '../../infrastructure/system/file-output';
import { FileProgressWriter } from '../../infrastructure/system/file-progress-writer';

export async function runCrawl(env: AppEnv, logger: Logger): Promise<number> {
  assertCommandEnv(env, 'crawl');
  const pool = createPostgresPool(env);
  const store = new PostgresRepositoryStore(pool);
  const searchClient = new GithubGraphqlClient(env, logger);
  const progressWriter = new FileProgressWriter(env.CRAWLER_PROGRESS_PATH);
  const crawler = new CrawlerService(env, logger, store, searchClient, progressWriter);

  try {
    await runMigrations(pool, logger, resolveMigrationsDir());
    const summary = await crawler.run();
    await writeJsonFile(env.RUN_SUMMARY_PATH, summary);

    logger.info({ command: 'crawl', summaryPath: env.RUN_SUMMARY_PATH, summary }, 'Crawler execution completed');

    if (env.CRAWLER_ENFORCE_TARGET) {
      const targetMet = summary.uniqueRepositories >= env.CRAWLER_TARGET;
      const underTenMinutes = summary.durationSeconds <= 600;
      if (!targetMet || !underTenMinutes || summary.status !== 'completed') {
        logger.error(
          {
            targetMet,
            underTenMinutes,
            status: summary.status,
            uniqueRepositories: summary.uniqueRepositories,
            targetRepositories: env.CRAWLER_TARGET,
            durationSeconds: summary.durationSeconds,
          },
          'Crawler performance gate failed',
        );
        return 1;
      }
    }

    return 0;
  } finally {
    await pool.end();
  }
}
