export interface CrawlExecutionSummary {
  crawlRunId: number;
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  durationSeconds: number;
  targetRepositories: number;
  uniqueRepositories: number;
  repositoriesSeen: number;
  repositoriesPersisted: number;
  apiRequests: number;
  retries: number;
  errors: number;
  stopReason: 'target_reached' | 'runtime_limit' | 'work_queue_exhausted' | 'error';
}
