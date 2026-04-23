import path from 'node:path';

import { newDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { Repository } from '../src/domain/repository';
import { createLogger } from '../src/infrastructure/logging/logger';
import { runMigrations } from '../src/infrastructure/db/migrator';
import { PostgresRepositoryStore } from '../src/infrastructure/db/postgres-repository-store';

function createSampleRepo(overrides: Partial<Repository> = {}): Repository {
  return {
    githubId: 'R_kgDOExample1',
    name: 'repo-name',
    nameWithOwner: 'octocat/repo-name',
    ownerLogin: 'octocat',
    description: 'sample repo',
    stargazerCount: 42,
    forkCount: 3,
    primaryLanguage: 'TypeScript',
    isPrivate: false,
    url: 'https://github.com/octocat/repo-name',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    pushedAt: '2024-01-03T00:00:00Z',
    ...overrides,
  };
}

describe('PostgresRepositoryStore', () => {
  it('creates crawl runs and upserts repositories by github_id', async () => {
    const db = newDb({ noAstCoverageCheck: true });
    const pgAdapter = db.adapters.createPg();
    const pool = new pgAdapter.Pool();
    const logger = createLogger({ level: 'silent', nodeEnv: 'test' });
    const migrationsDir = path.resolve(process.cwd(), 'migrations');

    await runMigrations(pool, logger, migrationsDir);

    const store = new PostgresRepositoryStore(pool);
    const runId = await store.createCrawlRun({ targetCount: 1000 });
    expect(runId).toBeGreaterThan(0);

    const firstWriteCount = await store.upsertRepositories([createSampleRepo()]);
    expect(firstWriteCount).toBe(1);

    const secondWriteCount = await store.upsertRepositories([
      createSampleRepo({ stargazerCount: 99 }),
    ]);
    expect(secondWriteCount).toBe(1);

    const rowCountResult = await pool.query('SELECT COUNT(*)::text AS count FROM repositories');
    expect(Number((rowCountResult.rows[0] as { count: string }).count)).toBe(1);

    const repoResult = await pool.query(
      'SELECT stargazer_count FROM repositories WHERE github_id = $1',
      ['R_kgDOExample1'],
    );
    expect((repoResult.rows[0] as { stargazer_count: number }).stargazer_count).toBe(99);

    await store.completeCrawlRun({
      id: runId,
      status: 'completed',
      repositoriesSeen: 2,
      repositoriesPersisted: 2,
      retries: 0,
      errors: 0,
    });

    const runResult = await pool.query('SELECT status FROM crawl_runs WHERE id = $1', [runId]);
    expect((runResult.rows[0] as { status: string }).status).toBe('completed');

    await pool.end();
  });
});
