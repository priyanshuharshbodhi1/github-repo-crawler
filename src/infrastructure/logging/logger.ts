import pino, { type LevelWithSilent, type Logger } from 'pino';

interface LoggerOptions {
  level: LevelWithSilent;
  nodeEnv: string;
}

export function createLogger(options: LoggerOptions): Logger {
  return pino({
    enabled: options.nodeEnv !== 'test',
    level: options.level,
    base: { service: 'github-repo-crawler' },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: pino.stdSerializers.err, error: pino.stdSerializers.err },
  });
}
