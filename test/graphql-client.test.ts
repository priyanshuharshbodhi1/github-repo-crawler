import { afterEach, describe, expect, it, vi } from 'vitest';

import { GithubGraphqlClient } from '../src/infrastructure/github/graphql-client';
import type { AppEnv } from '../src/infrastructure/config/env';

function makeEnv(): AppEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://localhost/test',
    DATABASE_MAX_CONNECTIONS: 1,
    DATABASE_IDLE_TIMEOUT_MS: 1000,
    GITHUB_TOKEN: 'test-token',
    GITHUB_API_URL: 'https://api.github.com/graphql',
    CRAWLER_TARGET: 100,
    CRAWLER_QUERY_PAGE_SIZE: 10,
    CRAWLER_DB_BATCH_SIZE: 100,
    CRAWLER_SHARD_CONCURRENCY: 1,
    CRAWLER_MAX_RUNTIME_SECONDS: 60,
    CRAWLER_MIN_RATE_LIMIT_REMAINING: 0,
    CRAWLER_RETRY_MAX_ATTEMPTS: 3,
    CRAWLER_RETRY_BASE_DELAY_MS: 0,
    CRAWLER_ENFORCE_TARGET: false,
    EXPORT_PATH: 'artifacts/repositories.json',
    RUN_SUMMARY_PATH: 'artifacts/run-summary.json',
    UI_DATASET_PATH: 'artifacts/ui-dataset.json',
    UI_TOP_REPOSITORIES_LIMIT: 10,
    CRAWLER_PROGRESS_PATH: 'artifacts/progress.json',
  };
}

function makeLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(),
  } as unknown as import('pino').Logger;
}

function makeSuccessBody() {
  return JSON.stringify({
    data: {
      rateLimit: { cost: 1, remaining: 4999, limit: 5000, used: 1, resetAt: new Date(Date.now() + 3600_000).toISOString() },
      search: {
        repositoryCount: 0,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [],
      },
    },
  });
}

describe('GithubGraphqlClient retry policy', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('retries on 429 and succeeds on the third attempt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(makeSuccessBody(), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    const client = new GithubGraphqlClient(makeEnv(), makeLogger());
    const result = await client.searchRepositories('is:public', 10, null);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(client.metrics.retries).toBe(2);
    expect(result.nodes).toHaveLength(0);
  });

  it('fails immediately on 401 without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new GithubGraphqlClient(makeEnv(), makeLogger());
    await expect(client.searchRepositories('is:public', 10, null)).rejects.toThrow('401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.metrics.retries).toBe(0);
  });

  it('retries on 500 server error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))
      .mockResolvedValueOnce(new Response(makeSuccessBody(), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    const client = new GithubGraphqlClient(makeEnv(), makeLogger());
    await client.searchRepositories('is:public', 10, null);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.metrics.retries).toBe(1);
  });

  it('gives up after max attempts and throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new GithubGraphqlClient(makeEnv(), makeLogger());
    await expect(client.searchRepositories('is:public', 10, null)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3); // CRAWLER_RETRY_MAX_ATTEMPTS=3
  });
});
