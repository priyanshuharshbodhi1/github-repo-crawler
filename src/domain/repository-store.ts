import type { CompleteCrawlRunInput, CreateCrawlRunInput } from './crawl-run';
import type { Repository } from './repository';

export interface RepositoryStore {
  createCrawlRun(input: CreateCrawlRunInput): Promise<number>;
  completeCrawlRun(input: CompleteCrawlRunInput): Promise<void>;
  upsertRepositories(repositories: Repository[]): Promise<number>;
}
