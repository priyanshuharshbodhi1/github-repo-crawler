CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  target_count INTEGER NOT NULL,
  repositories_seen INTEGER NOT NULL DEFAULT 0,
  repositories_persisted INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT crawl_runs_status_check CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS repositories (
  id BIGSERIAL PRIMARY KEY,
  github_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_with_owner TEXT NOT NULL,
  owner_login TEXT NOT NULL,
  description TEXT,
  stargazer_count INTEGER NOT NULL,
  fork_count INTEGER NOT NULL,
  primary_language TEXT,
  is_private BOOLEAN NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  pushed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_crawled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
