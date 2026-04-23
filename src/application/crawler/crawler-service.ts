import type { Logger } from 'pino';

import type { CrawlExecutionSummary } from '../../domain/crawl-summary';
import type { ProgressWriter } from '../../domain/progress-writer';
import type { Repository } from '../../domain/repository';
import type { RepositorySearchClient } from '../../domain/repository-search-client';
import type { RepositoryStore } from '../../domain/repository-store';
import type { AppEnv } from '../../infrastructure/config/env';
import { mapGithubNodeToRepository } from './repository-mapper';
import {
  buildSearchQuery,
  seedMonthlyShards,
  shouldSplitShard,
  splitShard,
  type CrawlShard,
} from './sharding';

interface CrawlMetrics {
  repositoriesSeen: number;
  repositoriesPersisted: number;
  errors: number;
}

interface RunStopState {
  shouldStop: boolean;
  reason: CrawlExecutionSummary['stopReason'] | null;
}

export class CrawlerService {
  constructor(
    private readonly env: AppEnv,
    private readonly logger: Logger,
    private readonly store: RepositoryStore,
    private readonly searchClient: RepositorySearchClient,
    private readonly progressWriter: ProgressWriter,
  ) {}

  async run(): Promise<CrawlExecutionSummary> {
    const startedAt = new Date();
    const startedAtMs = startedAt.getTime();
    const target = this.env.CRAWLER_TARGET;
    const maxRuntimeSeconds = this.env.CRAWLER_MAX_RUNTIME_SECONDS;

    const crawlRunId = await this.store.createCrawlRun({
      targetCount: target,
      metadata: {
        shardConcurrency: this.env.CRAWLER_SHARD_CONCURRENCY,
        dbBatchSize: this.env.CRAWLER_DB_BATCH_SIZE,
        pageSize: this.env.CRAWLER_QUERY_PAGE_SIZE,
      },
    });

    const metrics: CrawlMetrics = {
      repositoriesSeen: 0,
      repositoriesPersisted: 0,
      errors: 0,
    };

    const stopState: RunStopState = { shouldStop: false, reason: null };

    // FIFO queue — newest shards at the front (seedMonthlyShards returns reversed).
    // Workers use shift() so they process newest months first.
    // Split shards are unshift()ed to the front for immediate processing.
    const queue = seedMonthlyShards();
    const seenRepositoryIds = new Set<string>();
    const pendingWrites: Promise<void>[] = [];

    const workerCount = Math.max(1, this.env.CRAWLER_SHARD_CONCURRENCY);
    const workers = Array.from({ length: workerCount }, (_, index) =>
      this.workerLoop({
        workerId: index + 1,
        queue,
        seenRepositoryIds,
        metrics,
        stopState,
        startedAtMs,
        maxRuntimeSeconds,
        pendingWrites,
      }),
    );

    const progressInterval = setInterval(() => {
      const elapsed = (Date.now() - startedAtMs) / 1000;
      this.progressWriter.write({
        status: 'running',
        startedAt: startedAt.toISOString(),
        elapsedSeconds: Math.round(elapsed),
        targetRepositories: target,
        uniqueRepositories: seenRepositoryIds.size,
        repositoriesSeen: metrics.repositoriesSeen,
        repositoriesPersisted: metrics.repositoriesPersisted,
        apiRequests: this.searchClient.metrics.requests,
        retries: this.searchClient.metrics.retries,
        errors: metrics.errors,
      }).catch(() => { /* non-fatal */ });
    }, 1000);

    try {
      await Promise.all(workers);
      await Promise.all(pendingWrites);
    } catch (error) {
      stopState.shouldStop = true;
      stopState.reason = 'error';
      metrics.errors += 1;
      this.logger.error({ error }, 'Crawler failed with unhandled error');
    } finally {
      clearInterval(progressInterval);
    }

    const durationSeconds = (Date.now() - startedAtMs) / 1000;

    if (!stopState.reason) {
      if (seenRepositoryIds.size >= target) {
        stopState.reason = 'target_reached';
      } else if (durationSeconds >= maxRuntimeSeconds) {
        stopState.reason = 'runtime_limit';
      } else {
        stopState.reason = 'work_queue_exhausted';
      }
    }

    const status = stopState.reason === 'error' ? 'failed' : 'completed';
    await this.store.completeCrawlRun({
      id: crawlRunId,
      status,
      repositoriesSeen: metrics.repositoriesSeen,
      repositoriesPersisted: metrics.repositoriesPersisted,
      retries: this.searchClient.metrics.retries,
      errors: metrics.errors,
    });

    const finishedAt = new Date();
    const summary: CrawlExecutionSummary = {
      crawlRunId,
      status,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds,
      targetRepositories: target,
      uniqueRepositories: seenRepositoryIds.size,
      repositoriesSeen: metrics.repositoriesSeen,
      repositoriesPersisted: metrics.repositoriesPersisted,
      apiRequests: this.searchClient.metrics.requests,
      retries: this.searchClient.metrics.retries,
      errors: metrics.errors,
      stopReason: stopState.reason,
    };

    await this.progressWriter.write({ ...summary, status: 'done' }).catch(() => { /* non-fatal */ });

    return summary;
  }

  private async workerLoop(input: {
    workerId: number;
    queue: CrawlShard[];
    seenRepositoryIds: Set<string>;
    metrics: CrawlMetrics;
    stopState: RunStopState;
    startedAtMs: number;
    maxRuntimeSeconds: number;
    pendingWrites: Promise<void>[];
  }): Promise<void> {
    const localBatch: Repository[] = [];

    while (!input.stopState.shouldStop) {
      if (this.hasExceededRuntime(input.startedAtMs, input.maxRuntimeSeconds)) {
        input.stopState.shouldStop = true;
        input.stopState.reason = 'runtime_limit';
        break;
      }

      if (input.seenRepositoryIds.size >= this.env.CRAWLER_TARGET) {
        input.stopState.shouldStop = true;
        input.stopState.reason = 'target_reached';
        break;
      }

      // FIFO: take from the front of the queue
      const shard = input.queue.shift();
      if (!shard) break;

      try {
        await this.processShard({
          shard,
          queue: input.queue,
          seenRepositoryIds: input.seenRepositoryIds,
          metrics: input.metrics,
          stopState: input.stopState,
          localBatch,
          workerId: input.workerId,
          pendingWrites: input.pendingWrites,
        });
      } catch (error) {
        input.metrics.errors += 1;
        this.logger.error(
          { error, shardId: shard.id, workerId: input.workerId },
          'Failed to process shard',
        );
      }
    }

    await this.flushBatch(localBatch, input.metrics);
  }

  private async processShard(input: {
    shard: CrawlShard;
    queue: CrawlShard[];
    seenRepositoryIds: Set<string>;
    metrics: CrawlMetrics;
    stopState: RunStopState;
    localBatch: Repository[];
    workerId: number;
    pendingWrites: Promise<void>[];
  }): Promise<void> {
    const queryString = buildSearchQuery(input.shard);
    let after: string | null = null;
    let isFirstPage = true;

    while (!input.stopState.shouldStop) {
      const page = await this.searchClient.searchRepositories(
        queryString,
        this.env.CRAWLER_QUERY_PAGE_SIZE,
        after,
      );

      if (isFirstPage && shouldSplitShard(input.shard, page.repositoryCount)) {
        const split = splitShard(input.shard);
        if (split.length > 0) {
          // FIFO: unshift puts splits at the front so they are processed next
          input.queue.unshift(...split);
          this.logger.debug(
            {
              workerId: input.workerId,
              shardId: input.shard.id,
              repositoryCount: page.repositoryCount,
              childShardCount: split.length,
            },
            'Split shard due to high repository count',
          );
          return;
        }
      }

      input.metrics.repositoriesSeen += page.nodes.length;

      for (const node of page.nodes) {
        if (input.seenRepositoryIds.has(node.id)) continue;

        input.seenRepositoryIds.add(node.id);
        input.localBatch.push(mapGithubNodeToRepository(node));

        if (input.localBatch.length >= this.env.CRAWLER_DB_BATCH_SIZE) {
          const writePromise = this.flushBatch(input.localBatch, input.metrics);
          input.pendingWrites.push(writePromise);
          if (input.pendingWrites.length > 50) input.pendingWrites.splice(0, 25);
        }

        if (input.seenRepositoryIds.size >= this.env.CRAWLER_TARGET) {
          input.stopState.shouldStop = true;
          input.stopState.reason = 'target_reached';
          break;
        }
      }

      if (input.stopState.shouldStop) break;
      if (!page.hasNextPage || !page.endCursor) break;

      after = page.endCursor;
      isFirstPage = false;
    }
  }

  private async flushBatch(batch: Repository[], metrics: CrawlMetrics): Promise<void> {
    if (batch.length === 0) return;
    const repositories = batch.splice(0, batch.length);
    const persistedCount = await this.store.upsertRepositories(repositories);
    metrics.repositoriesPersisted += persistedCount;
  }

  private hasExceededRuntime(startedAtMs: number, maxRuntimeSeconds: number): boolean {
    return (Date.now() - startedAtMs) / 1000 >= maxRuntimeSeconds;
  }
}
