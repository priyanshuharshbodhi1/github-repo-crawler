import { describe, expect, it } from 'vitest';

import { buildRepositoryInsertBatch } from '../src/infrastructure/db/repository-batch';

describe('repository batch builder', () => {
  it('creates placeholder SQL and parameter list for multiple repositories', () => {
    const batch = buildRepositoryInsertBatch([
      {
        githubId: 'id-1',
        name: 'repo-1',
        nameWithOwner: 'owner/repo-1',
        ownerLogin: 'owner',
        description: null,
        stargazerCount: 10,
        forkCount: 2,
        primaryLanguage: 'TypeScript',
        isPrivate: false,
        url: 'https://github.com/owner/repo-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        pushedAt: '2024-01-01T00:00:00Z',
      },
      {
        githubId: 'id-2',
        name: 'repo-2',
        nameWithOwner: 'owner/repo-2',
        ownerLogin: 'owner',
        description: 'desc',
        stargazerCount: 20,
        forkCount: 4,
        primaryLanguage: null,
        isPrivate: false,
        url: 'https://github.com/owner/repo-2',
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        pushedAt: null,
      },
    ]);

    expect(batch.parameters.length).toBe(26);
    expect(batch.placeholdersSql).toContain('($1, $2, $3');
    expect(batch.placeholdersSql).toContain('$26');
  });
});
