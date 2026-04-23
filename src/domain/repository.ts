export interface Repository {
  githubId: string;
  name: string;
  nameWithOwner: string;
  ownerLogin: string;
  description: string | null;
  stargazerCount: number;
  forkCount: number;
  primaryLanguage: string | null;
  isPrivate: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
}

export interface CrawlRunStats {
  startedAt: string;
  finishedAt: string;
  repositoriesSeen: number;
  repositoriesPersisted: number;
  retries: number;
  errors: number;
}
