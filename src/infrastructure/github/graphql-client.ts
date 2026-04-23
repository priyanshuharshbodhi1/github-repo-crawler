import type { Logger } from 'pino';

import type { RepositorySearchClient, SearchPage } from '../../domain/repository-search-client';
import type { AppEnv } from '../config/env';
import { sleep } from '../system/sleep';

export interface GithubRateLimit {
  cost: number;
  remaining: number;
  limit: number;
  used: number;
  resetAt: string;
}

export interface GithubRepositoryNode {
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
  owner: {
    login: string;
  };
  primaryLanguage: {
    name: string;
  } | null;
}

export interface GithubSearchResponse {
  rateLimit: GithubRateLimit;
  search: {
    repositoryCount: number;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
    nodes: GithubRepositoryNode[];
  };
}

interface GraphqlError {
  message: string;
  type?: string;
}

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: GraphqlError[];
}

interface RequestOptions {
  query: string;
  variables: Record<string, unknown>;
}

export class GithubGraphqlClient implements RepositorySearchClient {
  private readonly apiUrl: string;
  private readonly token: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly minRateLimitRemaining: number;
  private readonly logger: Logger;
  private requestCounter = 0;
  private retryCounter = 0;

  constructor(env: AppEnv, logger: Logger) {
    this.apiUrl = env.GITHUB_API_URL;
    this.token = env.GITHUB_TOKEN ?? '';
    this.maxAttempts = env.CRAWLER_RETRY_MAX_ATTEMPTS;
    this.baseDelayMs = env.CRAWLER_RETRY_BASE_DELAY_MS;
    this.minRateLimitRemaining = env.CRAWLER_MIN_RATE_LIMIT_REMAINING;
    this.logger = logger;
  }

  get metrics(): { requests: number; retries: number } {
    return {
      requests: this.requestCounter,
      retries: this.retryCounter,
    };
  }

  async searchRepositories(
    queryString: string,
    first: number,
    after: string | null,
  ): Promise<SearchPage> {
    const query = `
      query SearchRepositories($query: String!, $first: Int!, $after: String) {
        rateLimit {
          cost
          remaining
          limit
          used
          resetAt
        }
        search(type: REPOSITORY, query: $query, first: $first, after: $after) {
          repositoryCount
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ... on Repository {
              id
              name
              nameWithOwner
              description
              stargazerCount
              forkCount
              isPrivate
              url
              createdAt
              updatedAt
              pushedAt
              owner {
                login
              }
              primaryLanguage {
                name
              }
            }
          }
        }
      }
    `;

    const data = await this.requestWithRetry<GithubSearchResponse>({
      query,
      variables: {
        query: queryString,
        first,
        after,
      },
    });

    await this.maybeThrottle(data.rateLimit);
    return {
      repositoryCount: data.search.repositoryCount,
      hasNextPage: data.search.pageInfo.hasNextPage,
      endCursor: data.search.pageInfo.endCursor,
      nodes: data.search.nodes,
    };
  }

  private async requestWithRetry<T>(options: RequestOptions): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        this.requestCounter += 1;
        return await this.executeRequest<T>(options);
      } catch (error) {
        lastError = error;
        if (attempt >= this.maxAttempts || !isRetryableError(error)) {
          throw error;
        }

        this.retryCounter += 1;
        const delayMs = computeBackoffDelay(this.baseDelayMs, attempt);
        this.logger.warn(
          {
            attempt,
            delayMs,
            error: formatError(error),
          },
          'Retrying GitHub GraphQL request',
        );
        await sleep(delayMs);
      }
    }

    throw lastError;
  }

  private async executeRequest<T>(options: RequestOptions): Promise<T> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'truxt-assignment-crawler',
      },
      body: JSON.stringify({
        query: options.query,
        variables: options.variables,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `GitHub GraphQL auth failed (${response.status}): ${body.slice(0, 200)}`,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        throw new RetryableError(
          `GitHub GraphQL HTTP ${response.status}: ${body.slice(0, 200)}`,
          response.status,
        );
      }
      throw new Error(`GitHub GraphQL HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const envelope = (await response.json()) as GraphqlEnvelope<T>;
    if (envelope.errors && envelope.errors.length > 0) {
      const combined = envelope.errors.map((entry) => entry.message).join('; ');
      const isRateLimited = envelope.errors.some((entry) =>
        entry.message.toLowerCase().includes('rate limit'),
      );

      if (isRateLimited) {
        throw new RetryableError(`GitHub GraphQL rate limited: ${combined}`, 429);
      }

      const isAbuse = envelope.errors.some((entry) =>
        entry.message.toLowerCase().includes('abuse'),
      );
      if (isAbuse) {
        throw new RetryableError(`GitHub GraphQL abuse limited: ${combined}`, 429);
      }

      throw new Error(`GitHub GraphQL errors: ${combined}`);
    }

    if (!envelope.data) {
      throw new Error('GitHub GraphQL returned no data');
    }

    return envelope.data;
  }

  private async maybeThrottle(rateLimit: GithubRateLimit): Promise<void> {
    if (rateLimit.remaining > this.minRateLimitRemaining) {
      return;
    }

    const resetTimestampMs = new Date(rateLimit.resetAt).getTime();
    const waitMs = Math.max(resetTimestampMs - Date.now() + 1000, 1000);
    this.logger.warn(
      {
        remaining: rateLimit.remaining,
        resetAt: rateLimit.resetAt,
        waitMs,
      },
      'Rate limit low, throttling until reset window',
    );
    await sleep(waitMs);
  }
}

class RetryableError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof RetryableError) {
    return true;
  }

  if (error instanceof TypeError) {
    return true;
  }

  return false;
}

function computeBackoffDelay(baseMs: number, attempt: number): number {
  const cappedAttempt = Math.min(attempt, 8);
  const exponential = baseMs * 2 ** (cappedAttempt - 1);
  const jitter = Math.floor(Math.random() * baseMs);
  return exponential + jitter;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
