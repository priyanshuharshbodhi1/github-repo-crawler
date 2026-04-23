# Testing Guide

How to verify every part of this system quickly.

---

## 1. Unit Tests (30 seconds, no setup needed)

```bash
npm install
npm test
```

No database, no GitHub token, no Docker required. Uses `pg-mem` (in-memory Postgres).

Expected output:
```
✓ test/sharding.test.ts (4 tests)
✓ test/repository-batch.test.ts (1 test)
✓ test/postgres-repository-store.test.ts (1 test)
✓ test/migrator.test.ts (2 tests)
✓ test/cli.test.ts (2 tests)
✓ test/env.test.ts (4 tests)
✓ test/crawler-service.test.ts (2 tests)
✓ test/graphql-client.test.ts (4 tests)
Test Files  8 passed (8)
Tests      20 passed (20)
```

### What each test covers

| File | Tests |
|---|---|
| `sharding.test.ts` | Monthly shards generated newest-first; query string built correctly; shard with 2000 results splits into 2 children; single-day shard falls back to star-range split |
| `repository-batch.test.ts` | 2 repos → 26 SQL parameters (13 columns × 2), correct placeholder format `($1,$2…)` |
| `postgres-repository-store.test.ts` | Insert repo → insert same repo with new star count → still 1 row in DB with updated count (upsert works) |
| `migrator.test.ts` | SQL files load sorted by filename; running migrations twice skips already-applied ones |
| `cli.test.ts` | `smoke` command exits 0; `crawl` without env vars exits 1 |
| `env.test.ts` | All defaults correct; missing `DATABASE_URL`/`GITHUB_TOKEN` throws `CommandEnvError`; `"true"`/`"false"` strings parse to booleans |
| `crawler-service.test.ts` | Stop-signal: workers stop cleanly at target and `flushBatch` is called; error isolation: shard errors are recorded without crashing the run |
| `graphql-client.test.ts` | 429 retries up to max attempts and succeeds; 401 fails immediately without retrying; 500 retries; exhausted attempts throw |

---

## 2. Code Quality Checks (10 seconds)

```bash
npm run lint     # ESLint — must pass with 0 errors
npm run build    # TypeScript compile — must pass with 0 type errors
```

---

## 3. Smoke Test (5 seconds, needs `.env`)

```bash
npm run smoke
```

Confirms env vars are parsed and CLI wiring works. Safe to run without a real DB or token.

---

## 4. Database Migration Test

```bash
npm run migrate
npm run migrate   # run twice — second run must say "skipped" not "applied"
```

Idempotent — safe to run multiple times. Verifies checksum integrity.

---

## 5. Full End-to-End Run

### Prerequisites

- Docker running with Postgres (see Setup in INFO.md)
- Valid `GITHUB_TOKEN` in `.env`

```bash
npm run migrate
npm run crawl          # ~7 minutes — watch logs for worker activity
npm run export:data
npm run verify:summary # must print "Run summary validation passed."
```

### Verify crawl results in DB

```sql
-- connect to your Postgres
SELECT COUNT(*) FROM repositories;
-- expected: 100000+

SELECT name_with_owner, stargazer_count
FROM repositories
ORDER BY stargazer_count DESC
LIMIT 5;
-- expected: well-known repos like ohmyzsh, elasticsearch, redis

SELECT status, repositories_persisted, duration_seconds
FROM crawl_runs
ORDER BY id DESC
LIMIT 1;
-- expected: status='completed', persisted >= 100000
```

### Verify artifacts

```bash
ls -lh artifacts/
# run-summary.json   ~400 bytes
# repositories.json  ~50 MB
# ui-dataset.json    ~230 KB

cat artifacts/run-summary.json
# must have: status=completed, uniqueRepositories>=100000, durationSeconds<=600
```

---

## 6. Dashboard (UI) Test

```bash
npm run ui:start
# open http://localhost:4173
```

**What to check:**
- Gate pill shows `TARGET MET` (green)
- Duration card shows ≤ 600s
- Unique Repos card shows ≥ 100,000
- Language chart renders with bars
- Star histogram renders with counts
- Search box filters the table in real time
- Language dropdown filters correctly
- Column headers sort the table on click
- Pagination prev/next works

**Live progress test** — open the dashboard, then in another terminal:
```bash
npm run crawl
```
The blue pulsing banner should appear within 1 second and update every second with rising repo count and progress bar.

---

## 7. CI Test (GitHub Actions)

Push any change to `main` on `https://github.com/priyanshuharshbodhi1/github-repo-crawler`.

The workflow runs automatically:
- All unit tests must pass
- Crawl must hit 100k repos in ≤ 600s
- `verify:summary` must pass
- Artifacts zip is downloadable from the Actions tab

To trigger manually without a push:
```bash
gh workflow run crawler-ci --repo priyanshuharshbodhi1/github-repo-crawler
gh run list --repo priyanshuharshbodhi1/github-repo-crawler
```

---

## 8. Quick Reviewer Checklist

| Check | Command | Expected |
|---|---|---|
| Unit tests pass | `npm test` | 14 tests, 0 failures |
| No lint errors | `npm run lint` | 0 errors |
| Types compile | `npm run build` | 0 errors |
| Migrations idempotent | `npm run migrate` twice | second run: all skipped |
| Crawl hits target | `npm run crawl` | `status=completed`, ≥100k repos |
| Gate passes | `npm run verify:summary` | "validation passed" |
| UI loads | `npm run ui:start` | gate pill = TARGET MET |
| CI green | GitHub Actions tab | all steps green |
