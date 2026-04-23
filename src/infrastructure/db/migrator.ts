import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Logger } from 'pino';
import type { Pool, PoolClient } from 'pg';

export interface MigrationFile {
  version: string;
  filename: string;
  fullPath: string;
  sql: string;
  checksum: string;
}

export interface MigrationReport {
  applied: string[];
  skipped: string[];
}

const MIGRATION_FILE_REGEX = /^(\d+)_.*\.sql$/;

export function resolveMigrationsDir(baseDir: string = process.cwd()): string {
  return path.resolve(baseDir, 'migrations');
}

export async function loadMigrationsFromDir(migrationsDir: string): Promise<MigrationFile[]> {
  const dirEntries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const migrationFiles = dirEntries
    .filter((entry) => entry.isFile() && MIGRATION_FILE_REGEX.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const migrations: MigrationFile[] = [];
  for (const filename of migrationFiles) {
    const fullPath = path.join(migrationsDir, filename);
    const sql = await fs.readFile(fullPath, 'utf-8');
    const version = filename.split('_')[0];
    const checksum = createHash('sha256').update(sql).digest('hex');
    migrations.push({ version, filename, fullPath, sql, checksum });
  }

  return migrations;
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedChecksums(client: PoolClient): Promise<Map<string, string>> {
  const result = await client.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations',
  );
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

async function applyMigration(client: PoolClient, migration: MigrationFile): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      `
      INSERT INTO schema_migrations (version, checksum)
      VALUES ($1, $2)
    `,
      [migration.version, migration.checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function runMigrations(
  pool: Pool,
  logger: Logger,
  migrationsDir: string = resolveMigrationsDir(),
): Promise<MigrationReport> {
  const migrations = await loadMigrationsFromDir(migrationsDir);
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const appliedChecksums = await getAppliedChecksums(client);

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migration of migrations) {
      const existingChecksum = appliedChecksums.get(migration.version);

      if (existingChecksum) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(
            `Migration checksum mismatch for version ${migration.version}. Existing checksum differs from file: ${migration.filename}`,
          );
        }
        skipped.push(migration.filename);
        continue;
      }

      await applyMigration(client, migration);
      applied.push(migration.filename);
      logger.info(
        { migration: migration.filename, version: migration.version },
        'Applied migration',
      );
    }

    return { applied, skipped };
  } finally {
    client.release();
  }
}
