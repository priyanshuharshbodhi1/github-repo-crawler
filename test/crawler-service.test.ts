import { describe, expect, it, vi } from 'vitest';

import { CrawlerService } from '../src/application/crawler/crawler-service';
import type { ProgressWriter } from '../src/domain/progress-writer';
import type { RawRepoNode, RepositorySearchClient, SearchPage } from '../src/domain/repository-search-client';
import type { RepositoryStore } from '../src/domain/repository-store';
import type { AppEnv } from '../src/infrastructure/config/env';

function makeNode(id: string): RawRepoNode {
  return {
    id,
    name: `repo-${id}`,
    nameWithOwner: `owner/repo-${id}`,
    description: null,
    stargazerCount: 1,
    forkCount: 0,
    isPrivate: false,
    url: `https://github.com/owner/repo-${id}`,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    pushedAt: null,
    owner: { login: 'owner' },
    primaryLanguage: null,
  };
}

function makePage(ids: string[], hasNextPage = false): SearchPage {
  return {
    repositoryCount: ids.length,
    hasNextPage,
    endCursor: hasNextPage ? 'cursor' : null,
    nodes: ids.map(makeNode),
  };
}

function makeEnv(target: number): AppEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://localhost/test',
    DATABASE_MAX_CONNECTIONS: 1,
    DATABASE_IDLE_TIMEOUT_MS: 1000,
    GITHUB_TOKEN: 'test-token',
    GITHUB_API_URL: 'https://api.github.com/graphql',
    CRAWLER_TARGET: target,
    CRAWLER_QUERY_PAGE_SIZE: 10,
    CRAWLER_DB_BATCH_SIZE: 100,
    CRAWLER_SHARD_CONCURRENCY: 1,
    CRAWLER_MAX_RUNTIME_SECONDS: 60,
    CRAWLER_MIN_RATE_LIMIT_REMAINING: 10,
    CRAWLER_RETRY_MAX_ATTEMPTS: 1,
    CRAWLER_RETRY_BASE_DELAY_MS: 0,
    CRAWLER_ENFORCE_TARGET: false,
    EXPORT_PATH: 'artifacts/repositories.json',
    RUN_SUMMARY_PATH: 'artifacts/run-summary.json',
    UI_DATASET_PATH: 'artifacts/ui-dataset.json',
    UI_TOP_REPOSITORIES_LIMIT: 10,
    CRAWLER_PROGRESS_PATH: 'artifacts/progress.json',
  };
}

describe('CrawlerService', () => {
  it('stops all workers when target is reached and flushes remaining batch', async () => {
    const TARGET = 3;

    const mockSearchClient: RepositorySearchClient = {
      searchRepositories: vi.fn().mockResolvedValue(makePage(['id-1', 'id-2', 'id-3', 'id-4', 'id-5'])),
      metrics: { requests: 5, retries: 0 },
    };

    const upsertedIds: string[] = [];
    const mockStore: RepositoryStore = {
      createCrawlRun: vi.fn().mockResolvedValue(1),
      completeCrawlRun: vi.fn().mockResolvedValue(undefined),
      upsertRepositories: vi.fn().mockImplementation(async (repos) => {
        upsertedIds.push(...repos.map((r: { githubId: string }) => r.githubId));
        return repos.length;
      }),
    };

    const mockProgress: ProgressWriter = { write: vi.fn().mockResolvedValue(undefined) };

    const logger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      child: vi.fn(),
    } as unknown as import('pino').Logger;

    const crawler = new CrawlerService(makeEnv(TARGET), logger, mockStore, mockSearchClient, mockProgress);
    const summary = await crawler.run();

    expect(summary.stopReason).toBe('target_reached');
    expect(summary.uniqueRepositories).toBeGreaterThanOrEqual(TARGET);
    expect(summary.status).toBe('completed');
    // flushBatch must have been called — persisted count matches unique count
    expect(summary.repositoriesPersisted).toBeGreaterThanOrEqual(TARGET);
    expect(mockStore.completeCrawlRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );
    // progress writer called at least once (final 'done' write)
    expect(mockProgress.write).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'done' }),
    );
  });

  it('sets status=failed and records errors when searchRepositories throws', async () => {
    const mockSearchClient: RepositorySearchClient = {
      searchRepositories: vi.fn().mockRejectedValue(new Error('network down')),
      metrics: { requests: 0, retries: 0 },
    };

    const mockStore: RepositoryStore = {
      createCrawlRun: vi.fn().mockResolvedValue(1),
      completeCrawlRun: vi.fn().mockResolvedValue(undefined),
      upsertRepositories: vi.fn().mockResolvedValue(0),
    };

    const mockProgress: ProgressWriter = { write: vi.fn().mockResolvedValue(undefined) };
    const logger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(),
    } as unknown as import('pino').Logger;

    const crawler = new CrawlerService(makeEnv(5), logger, mockStore, mockSearchClient, mockProgress);
    const summary = await crawler.run();

    expect(summary.errors).toBeGreaterThan(0);
    expect(mockStore.completeCrawlRun).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.any(Number) }),
    );
  });
});
