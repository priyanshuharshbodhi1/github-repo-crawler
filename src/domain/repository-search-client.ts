export interface RawRepoNode {
  id: string;
  name: string;
  nameWithOwner: string;
  description: string | null;
  stargazerCount: number;
  forkCount: number;
  isPrivate: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
  owner: { login: string };
  primaryLanguage: { name: string } | null;
}

export interface SearchPage {
  repositoryCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
  nodes: RawRepoNode[];
}

export interface RepositorySearchClient {
  searchRepositories(query: string, first: number, after: string | null): Promise<SearchPage>;
  readonly metrics: { requests: number; retries: number };
}
