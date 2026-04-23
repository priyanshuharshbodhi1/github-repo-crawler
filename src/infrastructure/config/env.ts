import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const logLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

const booleanEnvSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', ''].includes(normalized)) {
    return false;
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: logLevelSchema.default('info'),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(20),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  GITHUB_TOKEN: z.string().min(1).optional(),
  GITHUB_API_URL: z.string().url().default('https://api.github.com/graphql'),
  EXPORT_PATH: z.string().default('artifacts/repositories.json'),
  RUN_SUMMARY_PATH: z.string().default('artifacts/run-summary.json'),
  CRAWLER_TARGET: z.coerce.number().int().positive().default(100000),
  CRAWLER_QUERY_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(100),
  CRAWLER_DB_BATCH_SIZE: z.coerce.number().int().positive().default(2000),
  CRAWLER_SHARD_CONCURRENCY: z.coerce.number().int().positive().default(12),
  CRAWLER_MAX_RUNTIME_SECONDS: z.coerce.number().int().positive().default(600),
  CRAWLER_MIN_RATE_LIMIT_REMAINING: z.coerce.number().int().nonnegative().default(75),
  CRAWLER_RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(6),
  CRAWLER_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(250),
  CRAWLER_ENFORCE_TARGET: booleanEnvSchema.default(false),
  UI_DATASET_PATH: z.string().default('artifacts/ui-dataset.json'),
  UI_TOP_REPOSITORIES_LIMIT: z.coerce.number().int().positive().default(500),
  CRAWLER_PROGRESS_PATH: z.string().default('artifacts/progress.json'),
});

export type AppEnv = z.infer<typeof envSchema>;
export type CommandName = 'smoke' | 'crawl' | 'migrate' | 'export';

export class CommandEnvError extends Error {
  constructor(
    public readonly command: CommandName,
    public readonly missing: string[],
  ) {
    super(
      `Missing required environment variables for "${command}": ${missing.join(', ')}`,
    );
    this.name = 'CommandEnvError';
  }
}

export function parseEnv(rawEnv: NodeJS.ProcessEnv): AppEnv {
  return envSchema.parse(rawEnv);
}

export function loadEnv(): AppEnv {
  return parseEnv(process.env);
}

export function assertCommandEnv(env: AppEnv, command: CommandName): void {
  const requiredByCommand: Record<CommandName, Array<keyof AppEnv>> = {
    smoke: [],
    crawl: ['DATABASE_URL', 'GITHUB_TOKEN'],
    migrate: ['DATABASE_URL'],
    export: ['DATABASE_URL'],
  };

  const missing = requiredByCommand[command].filter((key) => {
    const value = env[key];
    return value === undefined || value === '';
  });

  if (missing.length > 0) {
    throw new CommandEnvError(command, missing.map((key) => String(key)));
  }
}
