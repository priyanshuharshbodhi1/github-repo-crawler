import { describe, expect, it } from 'vitest';

import { runCli } from '../src/interfaces/cli/index';

describe('cli', () => {
  it('returns success on smoke command', async () => {
    const exitCode = await runCli(['smoke'], { NODE_ENV: 'test' });
    expect(exitCode).toBe(0);
  });

  it('returns failure on crawl when required env vars are missing', async () => {
    const exitCode = await runCli(['crawl'], { NODE_ENV: 'test' });
    expect(exitCode).toBe(1);
  });
});
