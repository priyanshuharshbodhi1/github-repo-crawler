import { describe, expect, it } from 'vitest';

import {
  buildSearchQuery,
  seedMonthlyShards,
  shouldSplitShard,
  splitShard,
  type CrawlShard,
} from '../src/application/crawler/sharding';

describe('sharding', () => {
  it('seeds monthly shards in reverse chronological order', () => {
    const shards = seedMonthlyShards(new Date('2008-03-15T00:00:00.000Z'));
    expect(shards.length).toBe(3);
    expect(shards[0].createdFrom).toBe('2008-03-01');
    expect(shards[2].createdFrom).toBe('2008-01-01');
  });

  it('builds search query from shard boundaries', () => {
    const shard: CrawlShard = {
      id: 'x',
      createdFrom: '2024-01-01',
      createdTo: '2024-01-31',
      minStars: 10,
      maxStars: 200,
      depth: 0,
    };
    const query = buildSearchQuery(shard);
    expect(query).toContain('is:public');
    expect(query).toContain('sort:updated-asc');
    expect(query).toContain('stars:10..200');
    expect(query).toContain('created:2024-01-01..2024-01-31');
  });

  it('splits a date-range shard when result count is saturated', () => {
    const shard: CrawlShard = {
      id: 'x',
      createdFrom: '2024-01-01',
      createdTo: '2024-01-10',
      minStars: 0,
      maxStars: 1000,
      depth: 0,
    };

    expect(shouldSplitShard(shard, 2000)).toBe(true);
    const children = splitShard(shard);
    expect(children.length).toBe(2);
    expect(children[0].depth).toBe(1);
    expect(children[1].depth).toBe(1);
  });

  it('falls back to star-range split on a single-day shard', () => {
    const shard: CrawlShard = {
      id: 'x',
      createdFrom: '2024-01-01',
      createdTo: '2024-01-01',
      minStars: 0,
      maxStars: 100,
      depth: 0,
    };
    const children = splitShard(shard);
    expect(children.length).toBe(2);
    expect(children[0].createdFrom).toBe('2024-01-01');
    expect(children[1].createdTo).toBe('2024-01-01');
  });
});
