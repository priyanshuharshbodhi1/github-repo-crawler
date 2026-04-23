import type { Logger } from 'pino';

import { assertCommandEnv, type AppEnv } from '../../infrastructure/config/env';

export async function runSmoke(env: AppEnv, logger: Logger): Promise<number> {
  assertCommandEnv(env, 'smoke');

  logger.info(
    {
      command: 'smoke',
      nodeEnv: env.NODE_ENV,
      databaseConfigured: Boolean(env.DATABASE_URL),
      githubTokenConfigured: Boolean(env.GITHUB_TOKEN),
      targetRepositories: env.CRAWLER_TARGET,
      exportPath: env.EXPORT_PATH,
    },
    'CLI bootstrap check passed',
  );

  return 0;
}
