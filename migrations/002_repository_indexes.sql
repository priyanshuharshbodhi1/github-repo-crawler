CREATE INDEX IF NOT EXISTS idx_repositories_name_with_owner
  ON repositories (name_with_owner);

CREATE INDEX IF NOT EXISTS idx_repositories_stargazer_count_desc
  ON repositories (stargazer_count DESC);

CREATE INDEX IF NOT EXISTS idx_repositories_updated_at_desc
  ON repositories (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_repositories_owner_login
  ON repositories (owner_login);

CREATE INDEX IF NOT EXISTS idx_repositories_last_crawled_at_desc
  ON repositories (last_crawled_at DESC);

CREATE INDEX IF NOT EXISTS idx_crawl_runs_started_at_desc
  ON crawl_runs (started_at DESC);
