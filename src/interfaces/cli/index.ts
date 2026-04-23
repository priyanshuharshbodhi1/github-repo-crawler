import { ZodError } from 'zod';

import { runCrawl } from '../../application/commands/crawl';
import { runExport } from '../../application/commands/export';
import { runMigrate } from '../../application/commands/migrate';
import { runSmoke } from '../../application/commands/smoke';
import {
  CommandEnvError,
  parseEnv,
  type AppEnv,
  type CommandName,
} from '../../infrastructure/config/env';
import { createLogger } from '../../infrastructure/logging/logger';

const commandList: CommandName[] = ['smoke', 'crawl', 'migrate', 'export'];

function isCommand(value: string): value is CommandName {
  return commandList.includes(value as CommandName);
}

function printUsage(): void {
  console.log('Usage: npm run dev -- <command>');
  console.log('');
  console.log('Commands:');
  console.log('  smoke    Validate bootstrap wiring and config parsing');
  console.log('  crawl    Run high-throughput GitHub GraphQL crawler');
  console.log('  migrate  Run database migrations');
  console.log('  export   Export repositories from PostgreSQL to JSON');
}

const commandHandlers: Record<
  CommandName,
  (env: AppEnv, logger: ReturnType<typeof createLogger>) => Promise<number>
> = {
  smoke: runSmoke,
  crawl: runCrawl,
  migrate: runMigrate,
  export: runExport,
};

export async function runCli(
  argv: string[],
  rawEnv: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const commandArg = argv[0] ?? 'help';

  if (commandArg === 'help' || commandArg === '--help' || commandArg === '-h') {
    printUsage();
    return 0;
  }

  if (!isCommand(commandArg)) {
    console.error(`Unknown command: ${commandArg}`);
    printUsage();
    return 1;
  }

  try {
    const env = parseEnv(rawEnv);
    const logger = createLogger({ level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV });
    return await commandHandlers[commandArg](env, logger);
  } catch (error) {
    if (error instanceof ZodError) {
      console.error('Environment validation failed:', error.issues);
      return 1;
    }

    if (error instanceof CommandEnvError) {
      console.error(error.message);
      return 1;
    }

    console.error('Unhandled CLI error:', error);
    return 1;
  }
}

if (require.main === module) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
