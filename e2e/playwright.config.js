// Playwright config. Builds the planner binary, starts it on a free-ish port
// with a fresh temp database, and seeds it via scripts/seed.sh before tests.
import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A random port and a per-run binary path let several checkouts run e2e at once.
// This file is evaluated again in each worker process, so the chosen values
// are pinned into the environment on first evaluation and reused afterwards.
if (!process.env.PLANNER_E2E_PORT) {
  process.env.PLANNER_E2E_PORT = String(20000 + Math.floor(Math.random() * 10000));
}
if (!process.env.PLANNER_E2E_DIR) {
  process.env.PLANNER_E2E_DIR = mkdtempSync(join(tmpdir(), 'planner-e2e-'));
}
const PORT = process.env.PLANNER_E2E_PORT;
const dbDir = process.env.PLANNER_E2E_DIR;
const bin = join(dbDir, 'planner');
process.env.PLANNER_E2E_DB = join(dbDir, 'e2e.db');
process.env.PLANNER_E2E_BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './global-setup.js',
  use: {
    baseURL: process.env.PLANNER_E2E_BASE,
    viewport: { width: 1500, height: 900 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `cd .. && go build -o ${bin} . && ${bin} -addr 127.0.0.1:${PORT} -db ${process.env.PLANNER_E2E_DB}`,
    url: process.env.PLANNER_E2E_BASE + '/api/users',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
