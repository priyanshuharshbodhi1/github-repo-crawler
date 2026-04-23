export interface CrawlShard {
  id: string;
  createdFrom: string;
  createdTo: string;
  minStars: number;
  maxStars: number;
  depth: number;
}

export const MAX_RESULTS_PER_SHARD = 950;
const DEFAULT_MIN_STARS = 0;
const DEFAULT_MAX_STARS = 1_000_000;

export function seedMonthlyShards(now: Date = new Date()): CrawlShard[] {
  const shards: CrawlShard[] = [];
  const start = new Date(Date.UTC(2008, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));

  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));

    shards.push(
      createShard({
        createdFrom: formatDate(monthStart),
        createdTo: formatDate(monthEnd),
        minStars: DEFAULT_MIN_STARS,
        maxStars: DEFAULT_MAX_STARS,
        depth: 0,
      }),
    );

    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  // Prioritize newer repositories first for better chance of hitting target quickly.
  return shards.reverse();
}

export function buildSearchQuery(shard: CrawlShard): string {
  return [
    'is:public',
    'sort:updated-asc',
    `stars:${shard.minStars}..${shard.maxStars}`,
    `created:${shard.createdFrom}..${shard.createdTo}`,
  ].join(' ');
}

export function shouldSplitShard(shard: CrawlShard, repositoryCount: number): boolean {
  if (repositoryCount <= MAX_RESULTS_PER_SHARD) {
    return false;
  }

  return canSplitByDate(shard) || canSplitByStars(shard);
}

export function splitShard(shard: CrawlShard): CrawlShard[] {
  if (canSplitByDate(shard)) {
    const from = parseDate(shard.createdFrom);
    const to = parseDate(shard.createdTo);
    const midTime = Math.floor((from.getTime() + to.getTime()) / 2);
    const mid = new Date(midTime);

    const leftTo = mid;
    const rightFrom = new Date(mid.getTime() + DAY_MS);

    return [
      createShard({
        createdFrom: shard.createdFrom,
        createdTo: formatDate(leftTo),
        minStars: shard.minStars,
        maxStars: shard.maxStars,
        depth: shard.depth + 1,
      }),
      createShard({
        createdFrom: formatDate(rightFrom),
        createdTo: shard.createdTo,
        minStars: shard.minStars,
        maxStars: shard.maxStars,
        depth: shard.depth + 1,
      }),
    ];
  }

  if (canSplitByStars(shard)) {
    const mid = Math.floor((shard.minStars + shard.maxStars) / 2);
    return [
      createShard({
        createdFrom: shard.createdFrom,
        createdTo: shard.createdTo,
        minStars: shard.minStars,
        maxStars: mid,
        depth: shard.depth + 1,
      }),
      createShard({
        createdFrom: shard.createdFrom,
        createdTo: shard.createdTo,
        minStars: mid + 1,
        maxStars: shard.maxStars,
        depth: shard.depth + 1,
      }),
    ];
  }

  return [];
}

function createShard(input: Omit<CrawlShard, 'id'>): CrawlShard {
  return {
    ...input,
    id: `${input.createdFrom}_${input.createdTo}_${input.minStars}_${input.maxStars}_${input.depth}`,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function canSplitByDate(shard: CrawlShard): boolean {
  const from = parseDate(shard.createdFrom);
  const to = parseDate(shard.createdTo);
  return to.getTime() - from.getTime() >= DAY_MS;
}

function canSplitByStars(shard: CrawlShard): boolean {
  return shard.maxStars - shard.minStars >= 1;
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
