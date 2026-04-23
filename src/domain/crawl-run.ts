export type CrawlRunStatus = 'running' | 'completed' | 'failed';

export interface CreateCrawlRunInput {
  targetCount: number;
  metadata?: Record<string, unknown>;
}

export interface CompleteCrawlRunInput {
  id: number;
  status: CrawlRunStatus;
  repositoriesSeen: number;
  repositoriesPersisted: number;
  retries: number;
  errors: number;
}
