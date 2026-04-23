import type { Pool } from 'pg';

import type { CompleteCrawlRunInput, CreateCrawlRunInput } from '../../domain/crawl-run';
import type { Repository } from '../../domain/repository';
import type { RepositoryStore } from '../../domain/repository-store';
import { buildRepositoryInsertBatch } from './repository-batch';

export class PostgresRepositoryStore implements RepositoryStore {
  constructor(private readonly pool: Pool) {}

  async createCrawlRun(input: CreateCrawlRunInput): Promise<number> {
    const result = await this.pool.query<{ id: string | number }>(
      `
      INSERT INTO crawl_runs (target_count, metadata)
      VALUES ($1, $2::jsonb)
      RETURNING id
      `,
      [input.targetCount, JSON.stringify(input.metadata ?? {})],
    );

    return Number(result.rows[0].id);
  }

  async completeCrawlRun(input: CompleteCrawlRunInput): Promise<void> {
    await this.pool.query(
      `
      UPDATE crawl_runs
      SET
        finished_at = NOW(),
        status = $2,
        repositories_seen = $3,
        repositories_persisted = $4,
        retries = $5,
        errors = $6
      WHERE id = $1
      `,
      [
        input.id,
        input.status,
        input.repositoriesSeen,
        input.repositoriesPersisted,
        input.retries,
        input.errors,
      ],
    );
  }

  async upsertRepositories(repositories: Repository[]): Promise<number> {
    if (repositories.length === 0) {
      return 0;
    }

    const batch = buildRepositoryInsertBatch(repositories);
    const result = await this.pool.query(
      `
      INSERT INTO repositories (
        github_id,
        name,
        name_with_owner,
        owner_login,
        description,
        stargazer_count,
        fork_count,
        primary_language,
        is_private,
        url,
        created_at,
        updated_at,
        pushed_at,
        last_crawled_at
      )
      VALUES
      ${batch.placeholdersSql}
      ON CONFLICT (github_id) DO UPDATE
      SET
        name = EXCLUDED.name,
        name_with_owner = EXCLUDED.name_with_owner,
        owner_login = EXCLUDED.owner_login,
        description = EXCLUDED.description,
        stargazer_count = EXCLUDED.stargazer_count,
        fork_count = EXCLUDED.fork_count,
        primary_language = EXCLUDED.primary_language,
        is_private = EXCLUDED.is_private,
        url = EXCLUDED.url,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        pushed_at = EXCLUDED.pushed_at,
        last_crawled_at = NOW()
      `,
      batch.parameters,
    );

    return result.rowCount ?? 0;
  }
}
