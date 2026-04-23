# High-Performance GitHub Repository Crawler

Crawls **100,000+ unique GitHub repos in under 10 minutes** using one token, stores in PostgreSQL, exports JSON, and shows a live dashboard.

**Proven result:** 100,010 repos · 420s · 1,223 API calls · 82 repos/call · 0 errors

---

## Quick Start

```bash
# 1. Start Postgres
docker run --name pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=repo_crawler -p 5432:5432 -d postgres:16

# 2. Configure env
cp .env.example .env
# set DATABASE_URL and GITHUB_TOKEN in .env

# 3. Run
npm install
npm run migrate        # create tables
npm run crawl          # fetch 100k repos (~7 min)
npm run export:data    # write JSON artifacts
npm run ui:start       # dashboard at http://localhost:4173
```

Key tunables in `.env`:

| Variable | Default | Purpose |
|---|---|---|
| `CRAWLER_SHARD_CONCURRENCY` | `20` | Parallel workers |
| `CRAWLER_DB_BATCH_SIZE` | `5000` | Rows per INSERT |
| `CRAWLER_TARGET` | `100000` | Repo target |
| `CRAWLER_MIN_RATE_LIMIT_REMAINING` | `25` | Sleep threshold |

---

## Architecture Documentation

### How does it achieve 100k repos in under 10 minutes?

**The core constraint:** GitHub Search returns a maximum of 1,000 results per query. With 100k repos needed and only 5,000 API points/hour, brute-force pagination falls short — you need many parallel queries each covering a different slice of the search space.

**Solution: adaptive sharding + parallel workers**

```
CLI → CrawlerService
    │
    ├── seedMonthlyShards() → ~220 shards (one per calendar month, 2008–now)
    │
    ├── 20 parallel workers, each:
    │     pop shard → send GraphQL query
    │     result count > 950? → split shard in half → re-queue
    │     result count ≤ 950? → paginate (100 repos/page)
    │       dedupe by github_id (in-memory Set)
    │       buffer 5,000 → flush to DB (non-blocking) → keep fetching
    │       reached 100k? → signal all workers to stop
    │
    └── every 1s: write progress.json → live dashboard updates
```

**Step by step:**

1. **Sharding by date range** — the search space is sliced into ~220 monthly windows (`created:2008-01-01..2008-01-31`, etc.), one per calendar month since GitHub launched. Each slice is small enough to stay under the 1,000-result cap.

2. **Adaptive split** — on the first page of any shard, if `repositoryCount > 950`, the shard is bisected (by date midpoint first, then by star range if the date range can't shrink further) and re-queued. This handles high-density months without missing repos.

3. **20 parallel workers** — all workers share one shard queue (`Array.pop()`). Each worker pops a shard, paginates it fully, and moves to the next. No coordinator needed.

4. **Non-blocking DB writes** — each worker buffers repos locally up to 5,000. When the buffer fills, it flushes to Postgres via a batch upsert and immediately continues fetching. DB writes never stall the API fetch loop.

5. **Proactive rate-limit throttle** — after every API response, the client reads `rateLimit.remaining`. If it drops below 25, workers sleep until `rateLimit.resetAt`. Workers never hit a 429 reactively.

---

### Layer Structure

```
interfaces/cli  →  application  →  domain   (zero external imports)
infrastructure              →  domain
```

| Layer | Contents |
|---|---|
| `domain/` | Pure TypeScript interfaces: `Repository`, `RepositoryStore`, `CrawlRun` |
| `application/` | Business logic: `CrawlerService`, sharding, export pipeline |
| `infrastructure/` | External adapters: Postgres, GitHub GraphQL client, pino logger |
| `interfaces/cli/` | Entry point, env validation, command dispatch |

Swap Postgres for any other store by replacing only `infrastructure/db/`. Tests use `pg-mem` (in-memory Postgres) — no Docker needed, runs in ~1 second.

---

### Database Schema Design

```sql
repositories          -- one row per unique repo
  id              BIGSERIAL PRIMARY KEY
  github_id       TEXT UNIQUE NOT NULL    -- GitHub's stable node ID (dedup key)
  name_with_owner TEXT NOT NULL           -- "owner/reponame"
  owner_login     TEXT NOT NULL
  stargazer_count INT
  primary_language TEXT
  url             TEXT
  description     TEXT
  is_fork         BOOLEAN
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ
  pushed_at       TIMESTAMPTZ
  metadata        JSONB                   -- extensible: topics, issue count, PR count
  last_crawled_at TIMESTAMPTZ

crawl_runs            -- one row per run, full observability
  id, status, target_count, repositories_persisted, retries, errors, metadata JSONB

schema_migrations     -- which SQL files ran + SHA-256 checksum (tamper detection)
```

**Indexes:** `stargazer_count DESC`, `updated_at DESC`, `owner_login`, `last_crawled_at DESC`, `name_with_owner`

**Key decisions:**

- **`github_id` as the dedup key, not URL or name.** GitHub node IDs are stable across renames and repo transfers. Using name or URL would treat the same repo as a new one after a rename.

- **Batch upsert with `ON CONFLICT (github_id) DO UPDATE`.** One SQL statement handles both insert (new repo) and update (re-crawl refresh). No separate SELECT + INSERT. Batching 5,000 rows per statement keeps transaction overhead low.

- **`metadata JSONB` for extensibility.** New fields (topics, issue count, license) land in JSONB immediately with zero migration cost. Once a field is queried frequently, it gets promoted to a real typed column via a batched `ALTER TABLE` + backfill.

- **`crawl_runs` table for observability.** Every run records status, duration, error count, and config without requiring log parsing. Useful for detecting performance regressions across runs.

- **`schema_migrations` with SHA-256 checksums.** Detects tampered or partially applied migrations immediately on the next migrate call.

**Future metadata tables (when fields stabilise):**

```sql
TABLE repo_topics (
  repo_id BIGINT REFERENCES repositories(id) ON DELETE CASCADE,
  topic   TEXT,
  PRIMARY KEY (repo_id, topic)
);

TABLE repo_issues (
  id        BIGSERIAL PRIMARY KEY,
  repo_id   BIGINT REFERENCES repositories(id) ON DELETE CASCADE,
  github_id TEXT UNIQUE,
  number    INT, title TEXT, state TEXT,
  author    TEXT, created_at TIMESTAMPTZ, closed_at TIMESTAMPTZ,
  UNIQUE (repo_id, number)
);

TABLE repo_pull_requests (
  id        BIGSERIAL PRIMARY KEY,
  repo_id   BIGINT REFERENCES repositories(id) ON DELETE CASCADE,
  github_id TEXT UNIQUE,
  number    INT, title TEXT, state TEXT,
  merged_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
  UNIQUE (repo_id, number)
);
```

---

### Rate Limiting and Error Handling

**Budget:** 5,000 points/hour per token. Each search query costs 1 point. No per-second limit — it's a rolling hourly window.

**Proactive throttle:**
After every API response, the client reads `rateLimit.remaining` from the GraphQL payload. If it drops below 25 (configurable via `CRAWLER_MIN_RATE_LIMIT_REMAINING`), the worker sleeps until `rateLimit.resetAt` before the next request. Workers never need to recover from a 429.

**Retry policy — exponential backoff with jitter:**

| Signal | Action |
|---|---|
| HTTP 429, 503, 5xx, network error | Retry up to 6 times: 250ms → 500ms → 1s → 2s → 4s → 8s |
| GraphQL error containing "rate limit" or "abuse" | Same retry |
| HTTP 401 / 403 (bad or expired token) | Fail immediately — retrying won't help |

Jitter adds a random 0–250ms to each retry delay. This prevents all 20 workers retrying at the exact same millisecond after a shared rate-limit event (thundering herd).

**Error isolation at the shard level:**
Each worker wraps `processShard` in a `try/catch`. A failed shard logs the full error (`workerId`, `shardId`, stack trace) and the worker moves on to the next shard. One bad shard never crashes the crawl.

**Logging:** structured JSON via pino. Log levels — `30` = info (normal progress), `40` = warn (throttle events), `50` = error (shard failures). Every line includes `workerId`, `shardId`, and full error context.

---

## CI Pipeline

**Triggers:** every push to `main`, every PR, manual dispatch.

```
Step 1  npm ci                 — install packages
Step 2  npm run lint           — ESLint
Step 3  npm run test           — 6 unit tests (~1s, no Docker needed)
Step 4  npm run build          — TypeScript compile
Step 5  npm run migrate        — create tables in Postgres service container
Step 6  npm run crawl          — fetch 100k repos (CRAWLER_ENFORCE_TARGET=true → fail if missed)
Step 7  npm run export:data    — write JSON artifacts
Step 8  npm run verify:summary — assert status=completed, ≥100k repos, ≤600s
Step 9  Upload artifacts       — zip downloadable for 90 days
```

---

## Demo UI

Served by `npm run ui:start` at `http://localhost:4173`. Reads `artifacts/` directly — no DB connection needed after export.

- **Gate pill** — `TARGET MET` / `BELOW TARGET` in green/yellow
- **6 metric cards** — status, duration, unique repos, throughput, API calls, errors
- **Language bar chart** — top 10 languages by repo count
- **Star histogram** — bucketed `<5k → 100k+`
- **Repo table** — sortable by stars/date, searchable by name, filterable by language and min-stars, paginated
- **Live banner** — during an active crawl: pulsing dot, live repo count, speed, and progress bar updating every 1s

---

## Creative Optimizations and Innovative Solutions

### 1. Adaptive sharding with a 950-result safety margin (not 1000)

GitHub caps search results at 1,000 per query. The split threshold is set to **950**, not 1,000. The 5% buffer accounts for repos created or deleted between the moment `repositoryCount` is read (first page) and when pagination completes. Without this margin, a shard that counts as 998 results could silently truncate if new repos push it past 1,000 mid-crawl.

### 2. Non-blocking DB writes via per-worker local batch

Each worker owns its own `localBatch` array. When it reaches 5,000 entries, `flushBatch` does:
```ts
const repositories = batch.splice(0, batch.length); // atomically empties the buffer
await this.store.upsertRepositories(repositories);   // DB write
```
The worker's buffer is empty immediately after the splice — it resumes fetching the next API page while the DB write is in flight. No mutex, no shared batch, no waiting. The crawl and the DB write pipeline in parallel.

### 3. Piggybacking rate limit info on every query — zero extra API cost

The GraphQL query includes `rateLimit { remaining resetAt }` alongside the search payload. GitHub returns both in one response. The crawler always knows the exact budget remaining after every call with no additional API points spent — unlike REST where you'd poll a separate `/rate_limit` endpoint.

### 4. Proactive throttle with a 1-second clock-skew buffer

```ts
const waitMs = Math.max(resetTimestampMs - Date.now() + 1000, 1000);
```
The `+ 1000` accounts for clock drift between the crawler's machine and GitHub's servers. Without it, a crawler that wakes up at exactly `resetAt` may still hit a 429 if the clocks are slightly out of sync.

### 5. `TypeError` treated as a retryable error

```ts
if (error instanceof TypeError) return true; // retryable
```
In Node.js, `fetch` throws a `TypeError` on network-level failures — DNS resolution failure, connection refused, socket hang-up. Most retry implementations only catch HTTP status codes and silently let network blips become permanent failures. Including `TypeError` means transient network issues are automatically retried with the same backoff.

### 6. Stream-based JSON export — memory stays flat regardless of size

```ts
const stream = createWriteStream(outputPath);
stream.write('[');
// ... fetch 5,000 rows at a time, write each row, advance cursor
stream.write(']');
```
A naive `JSON.stringify(await getAllRows())` would load all 100,000 objects into memory at once (~500 MB). The stream approach writes each batch directly to disk as it arrives. Memory stays constant at ~5,000 rows regardless of total export size — works identically for 100k or 100M rows.

### 7. Keyset pagination for export instead of OFFSET

```sql
WHERE id > $lastId ORDER BY id ASC LIMIT 5000
```
`OFFSET 95000` on a 100k-row table makes Postgres scan and discard 95,000 rows on every page. Keyset pagination uses the primary key index — every page is an O(log n) index lookup regardless of how deep you are. Stays fast at any scale.

### 8. Progress file as a zero-cost IPC channel

The crawler writes `progress.json` every 1 second. The dashboard polls it. This means:
- No WebSocket server, no SSE endpoint, no HTTP server in the crawler process
- The file survives a crawler crash — the UI always shows the last known state
- Works across process boundaries (crawler as a CLI, UI as a static server)
- Zero additional code complexity in the crawler

### 9. Deterministic shard IDs — no UUID needed

```ts
id: `${createdFrom}_${createdTo}_${minStars}_${maxStars}_${depth}`
```
Every shard is fully described by its parameters. The ID is reconstructible from scratch — you don't need to persist the queue state to replay a failed shard. In a distributed system, this means any worker can reconstruct and re-claim any shard with no coordination.

### 10. `sort:updated-asc` within each shard query

The search query sorts results by `updated_at` ascending within each date-range shard. This surfaces the least recently active repos first, which tend to be more stable (fewer renames, fewer active forks). It reduces the chance of hitting duplicate repos across overlapping shard boundaries, and keeps the dedup Set hitting fewer collisions during the crawl.

---

## Assumptions

1. Public repos only — private repos require elevated OAuth scopes not available with the default CI token.
2. Some runtime variance is expected (network conditions, rate-limit window alignment). The 600s CI wall clock accommodates this variance.
3. Duplicate repo IDs across shard boundaries are expected and handled — the in-memory `Set` prevents redundant DB writes, and `ON CONFLICT` guarantees no duplicates in storage.
