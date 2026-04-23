import type { Repository } from '../../domain/repository';

export interface RepositoryInsertBatch {
  placeholdersSql: string;
  parameters: unknown[];
}

const REPOSITORY_COLUMNS_PER_ROW = 13;

export function buildRepositoryInsertBatch(repositories: Repository[]): RepositoryInsertBatch {
  const parameters: unknown[] = [];
  const placeholders: string[] = [];

  repositories.forEach((repo, index) => {
    const base = index * REPOSITORY_COLUMNS_PER_ROW;
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, NOW())`,
    );

    parameters.push(
      repo.githubId,
      repo.name,
      repo.nameWithOwner,
      repo.ownerLogin,
      repo.description,
      repo.stargazerCount,
      repo.forkCount,
      repo.primaryLanguage,
      repo.isPrivate,
      repo.url,
      repo.createdAt,
      repo.updatedAt,
      repo.pushedAt,
    );
  });

  return {
    placeholdersSql: placeholders.join(',\n'),
    parameters,
  };
}
