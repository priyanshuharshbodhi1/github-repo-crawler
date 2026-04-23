# GitHub Repository Crawler

High-performance GitHub repository crawler built in TypeScript. Extracts **100,000+ unique repositories in under 10 minutes** using a single GitHub token, stores them in PostgreSQL, and exports JSON artifacts via GitHub Actions CI.

**Proven result:** 100,010 repos · 420s · 1,223 API calls · 0 errors

> Full architecture details: [INFO.md](./INFO.md)
> 500M scaling strategy: [SCALING.md](./SCALING.md)

---

## Setup

### Prerequisites
- Node.js 20+
- PostgreSQL 16 (or Docker)
- A GitHub personal access token (read:public only)

### Run locally

```bash
# 1. Start Postgres
docker run --name pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=repo_crawler \
  -p 5432:5432 -d postgres:16

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL and GITHUB_TOKEN

# 3. Install and run
npm install
npm run migrate        # create tables
npm run crawl          # fetch 100k repos (~7 min)
npm run export:data    # write JSON to artifacts/
npm run ui:start       # dashboard at http://localhost:4173
```

### Key environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | — | GitHub PAT (read:public scope) |
| `DATABASE_URL` | — | Postgres connection string |
| `CRAWLER_SHARD_CONCURRENCY` | `20` | Parallel workers |
| `CRAWLER_DB_BATCH_SIZE` | `5000` | Rows per INSERT |
| `CRAWLER_TARGET` | `100000` | Repo target count |
| `CRAWLER_MAX_RUNTIME_SECONDS` | `600` | Hard time limit |
| `CRAWLER_MIN_RATE_LIMIT_REMAINING` | `25` | Throttle threshold |

---

## Source Code Structure

```
src/
├── domain/              # Pure interfaces — Repository, RepositoryStore, CrawlRun
├── application/
│   ├── crawler/         # CrawlerService, sharding logic, repository mapper
│   └── export/          # JSON export pipeline
├── infrastructure/
│   ├── github/          # GraphQL client, retry + rate-limit logic
│   ├── db/              # Postgres store, batch upsert, migrator
│   ├── config/          # Env validation (zod)
│   └── system/          # File I/O, sleep
└── interfaces/cli/      # Entry point, command dispatch
```

```
migrations/              # Idempotent SQL files with SHA-256 checksum tracking
test/                    # 6 vitest unit tests (pg-mem, no Docker needed)
ui/                      # Vanilla JS dashboard (reads artifacts/, no DB needed)
.github/workflows/       # crawler-ci.yml — full CI pipeline
```

---

## Architecture

### How it works

GitHub Search is capped at **1,000 results per query**. To reach 100,000 repos with one token (5,000 API points/hour), the crawler uses **adaptive sharding**:

1. **Seed ~220 monthly shards** — one per calendar month from 2008 to now (`created:YYYY-MM-DD..YYYY-MM-DD`). Each month is small enough to stay under the cap.
2. **20 parallel workers** share a single shard queue. Each worker pops a shard, paginates it (100 repos/page), and moves to the next.
3. **Adaptive split** — if a shard's first page reports `repositoryCount > 950`, the shard is bisected by date (then by star range if needed) and re-queued. Threshold is 950, not 1000, to absorb repos created mid-crawl.
4. **Non-blocking writes** — each worker buffers 5,000 repos locally, flushes to Postgres via batch upsert, and immediately continues fetching. DB writes never block the API loop.
5. **Proactive throttle** — after every response, if `rateLimit.remaining < 25`, the worker sleeps until `rateLimit.resetAt + 1s` (the +1s absorbs clock skew). Workers never hit a reactive 429.

### Database schema

```sql
repositories   — github_id TEXT UNIQUE (dedup key), core fields, metadata JSONB
crawl_runs     — one row per run, full observability (status, duration, errors)
schema_migrations — SHA-256 checksum per migration file (tamper detection)
```

- `github_id` used as the dedup key (stable across repo renames and transfers)
- `ON CONFLICT (github_id) DO UPDATE` — single statement handles insert and re-crawl update
- `metadata JSONB` — new fields (topics, issue count) land here with zero migration cost
- Indexes on `stargazer_count DESC`, `updated_at DESC`, `owner_login`, `last_crawled_at DESC`

### Rate limiting and errors

- **Proactive throttle:** sleep before hitting zero, not after a 429
- **Retry policy:** exponential backoff (250ms → 8s) with jitter, up to 6 attempts
- **Retryable:** HTTP 429/5xx, network errors (`TypeError`), GraphQL rate-limit errors
- **Non-retryable:** HTTP 401/403 — bad token won't fix itself
- **Shard isolation:** a failed shard logs and continues; one bad shard never crashes the run

---

## CI Pipeline

The GitHub Actions workflow (`.github/workflows/crawler-ci.yml`) runs on every push and PR:

| Step | What it does |
|---|---|
| `npm ci` | Install dependencies |
| `npm run lint` | ESLint |
| `npm run test` | 6 unit tests (~1s, no Docker) |
| `npm run build` | TypeScript compile |
| `npm run migrate` | Create tables in Postgres service container |
| `npm run crawl` | Fetch 100k repos (`CRAWLER_ENFORCE_TARGET=true`) |
| `npm run export:data` | Write JSON artifacts |
| `npm run verify:summary` | Assert: status=completed, ≥100k repos, ≤600s |
| Upload artifact | Zip of JSON files, downloadable for 90 days |

---

## Tests

```bash
npm run test
```

6 unit tests covering: sharding logic, batch SQL builder, Postgres store (pg-mem), migrator checksum, CLI command dispatch, env validation. Run in ~1 second with no external dependencies.

---

## Demo UI

```bash
npm run export:data   # generate artifacts/ first
npm run ui:start      # http://localhost:4173
```

- Live progress banner during crawl (1s poll)
- `TARGET MET` / `BELOW TARGET` gate pill
- Language bar chart, star histogram
- Sortable, searchable, filterable repo table (paginated)
