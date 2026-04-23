import { Pool } from 'pg';

import type { AppEnv } from '../config/env';

export function createPostgresPool(env: AppEnv): Pool {
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_MAX_CONNECTIONS,
    idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
  });
}
