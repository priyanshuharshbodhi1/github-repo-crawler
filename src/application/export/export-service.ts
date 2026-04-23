import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Logger } from 'pino';
import type { Pool } from 'pg';

interface RepositoryExportRow {
  id: number;
  github_id: string;
  name: string;
  name_with_owner: string;
  owner_login: string;
  description: string | null;
  stargazer_count: number;
  fork_count: number;
  primary_language: string | null;
  is_private: boolean;
  url: string;
  created_at: string;
  updated_at: string;
  pushed_at: string | null;
  last_crawled_at: string;
}

interface UiRepositoryRow {
  github_id: string;
  name_with_owner: string;
  owner_login: string;
  description: string | null;
  stargazer_count: number;
  fork_count: number;
  primary_language: string | null;
  url: string;
  updated_at: string;
  pushed_at: string | null;
}

export async function exportRepositoriesToJson(params: {
  pool: Pool;
  outputPath: string;
  logger: Logger;
  batchSize?: number;
}): Promise<{ exportedCount: number; outputPath: string }> {
  const batchSize = params.batchSize ?? 5000;
  const absoluteOutputPath = path.resolve(params.outputPath);

  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  const stream = createWriteStream(absoluteOutputPath, { encoding: 'utf-8' });
  let exportedCount = 0;
  let lastId = 0;
  let isFirstItem = true;

  await writeToStream(stream, '[');

  let hasMoreRows = true;
  while (hasMoreRows) {
    const queryResult = await params.pool.query<RepositoryExportRow>(
      `
      SELECT
        id,
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
        created_at::text,
        updated_at::text,
        pushed_at::text,
        last_crawled_at::text
      FROM repositories
      WHERE id > $1
      ORDER BY id ASC
      LIMIT $2
      `,
      [lastId, batchSize],
    );

    if (queryResult.rows.length === 0) {
      hasMoreRows = false;
      continue;
    }

    for (const row of queryResult.rows) {
      if (!isFirstItem) {
        await writeToStream(stream, ',');
      }
      await writeToStream(stream, `\n${JSON.stringify(row)}`);
      exportedCount += 1;
      lastId = row.id;
      isFirstItem = false;
    }
  }

  if (!isFirstItem) {
    await writeToStream(stream, '\n');
  }
  await writeToStream(stream, ']');
  await endStream(stream);

  params.logger.info(
    {
      exportedCount,
      outputPath: absoluteOutputPath,
    },
    'Exported repositories to JSON file',
  );

  return {
    exportedCount,
    outputPath: absoluteOutputPath,
  };
}

export async function exportUiDataset(params: {
  pool: Pool;
  outputPath: string;
  logger: Logger;
  limit: number;
}): Promise<{ exportedCount: number; outputPath: string }> {
  const absoluteOutputPath = path.resolve(params.outputPath);
  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  const latestSummary = await params.pool.query<{
    id: number;
    status: string;
    started_at: string;
    finished_at: string | null;
    target_count: number;
    repositories_seen: number;
    repositories_persisted: number;
    retries: number;
    errors: number;
  }>(
    `
    SELECT
      id,
      status,
      started_at::text,
      finished_at::text,
      target_count,
      repositories_seen,
      repositories_persisted,
      retries,
      errors
    FROM crawl_runs
    ORDER BY id DESC
    LIMIT 1
    `,
  );

  const topRepositories = await params.pool.query<UiRepositoryRow>(
    `
    SELECT
      github_id,
      name_with_owner,
      owner_login,
      description,
      stargazer_count,
      fork_count,
      primary_language,
      url,
      updated_at::text,
      pushed_at::text
    FROM repositories
    ORDER BY stargazer_count DESC, updated_at DESC
    LIMIT $1
    `,
    [params.limit],
  );

  const totals = await params.pool.query<{ total_repositories: string }>(
    'SELECT COUNT(*)::text AS total_repositories FROM repositories',
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    totals: {
      repositories: Number(totals.rows[0].total_repositories),
      topRepositoriesLimit: params.limit,
    },
    latestRun: latestSummary.rows[0] ?? null,
    topRepositories: topRepositories.rows,
  };

  await fs.writeFile(absoluteOutputPath, JSON.stringify(payload, null, 2), 'utf-8');

  params.logger.info(
    {
      exportedCount: topRepositories.rowCount ?? 0,
      outputPath: absoluteOutputPath,
    },
    'Exported UI dataset',
  );

  return {
    exportedCount: topRepositories.rowCount ?? 0,
    outputPath: absoluteOutputPath,
  };
}

function writeToStream(
  stream: NodeJS.WritableStream,
  chunk: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function endStream(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.once('finish', () => {
      resolve();
    });
    stream.end();
  });
}
