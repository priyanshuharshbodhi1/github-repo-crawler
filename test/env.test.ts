import { describe, expect, it } from 'vitest';

import {
  assertCommandEnv,
  CommandEnvError,
  parseEnv,
} from '../src/infrastructure/config/env';

describe('env config', () => {
  it('applies defaults when env values are not provided', () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DATABASE_MAX_CONNECTIONS).toBe(20);
    expect(env.DATABASE_IDLE_TIMEOUT_MS).toBe(30000);
    expect(env.GITHUB_API_URL).toBe('https://api.github.com/graphql');
    expect(env.CRAWLER_TARGET).toBe(100000);
    expect(env.CRAWLER_QUERY_PAGE_SIZE).toBe(100);
    expect(env.CRAWLER_DB_BATCH_SIZE).toBe(2000);
    expect(env.CRAWLER_SHARD_CONCURRENCY).toBe(12);
    expect(env.CRAWLER_MAX_RUNTIME_SECONDS).toBe(600);
    expect(env.CRAWLER_MIN_RATE_LIMIT_REMAINING).toBe(75);
    expect(env.CRAWLER_RETRY_MAX_ATTEMPTS).toBe(6);
    expect(env.CRAWLER_RETRY_BASE_DELAY_MS).toBe(250);
    expect(env.CRAWLER_ENFORCE_TARGET).toBe(false);
    expect(env.RUN_SUMMARY_PATH).toBe('artifacts/run-summary.json');
    expect(env.EXPORT_PATH).toBe('artifacts/repositories.json');
    expect(env.UI_DATASET_PATH).toBe('artifacts/ui-dataset.json');
    expect(env.UI_TOP_REPOSITORIES_LIMIT).toBe(500);
  });

  it('throws for missing command requirements', () => {
    const env = parseEnv({});
    expect(() => assertCommandEnv(env, 'crawl')).toThrow(CommandEnvError);
  });

  it('accepts valid command requirements', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/repos',
      GITHUB_TOKEN: 'token-123',
    });
    expect(() => assertCommandEnv(env, 'crawl')).not.toThrow();
  });

  it('parses boolean-like env strings safely', () => {
    const falseEnv = parseEnv({ CRAWLER_ENFORCE_TARGET: 'false' });
    expect(falseEnv.CRAWLER_ENFORCE_TARGET).toBe(false);

    const trueEnv = parseEnv({ CRAWLER_ENFORCE_TARGET: 'true' });
    expect(trueEnv.CRAWLER_ENFORCE_TARGET).toBe(true);
  });
});
