#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const summaryPath = process.env.RUN_SUMMARY_PATH || 'artifacts/run-summary.json';
const target = Number(process.env.CRAWLER_TARGET || '100000');
const maxSeconds = Number(process.env.CRAWLER_EXPECT_MAX_SECONDS || '600');

const absolutePath = path.resolve(summaryPath);
if (!fs.existsSync(absolutePath)) {
  console.error(`Run summary file not found: ${absolutePath}`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
const checks = [
  {
    ok: summary.status === 'completed',
    message: `status must be completed (actual: ${summary.status})`,
  },
  {
    ok: Number(summary.uniqueRepositories) >= target,
    message: `uniqueRepositories must be >= ${target} (actual: ${summary.uniqueRepositories})`,
  },
  {
    ok: Number(summary.durationSeconds) <= maxSeconds,
    message: `durationSeconds must be <= ${maxSeconds} (actual: ${summary.durationSeconds})`,
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error('Run summary validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure.message}`);
  }
  process.exit(1);
}

console.log('Run summary validation passed.');
