import type { Repository } from '../../domain/repository';
import type { RawRepoNode } from '../../domain/repository-search-client';

export function mapGithubNodeToRepository(node: RawRepoNode): Repository {
  return {
    githubId: node.id,
    name: node.name,
    nameWithOwner: node.nameWithOwner,
    ownerLogin: node.owner.login,
    description: node.description,
    stargazerCount: node.stargazerCount,
    forkCount: node.forkCount,
    primaryLanguage: node.primaryLanguage?.name ?? null,
    isPrivate: node.isPrivate,
    url: node.url,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    pushedAt: node.pushedAt,
  };
}
