// Playwright config. Builds the planner binary, starts it on a free-ish port
// with a fresh temp database, and seeds it via scripts/seed.sh before tests.
import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.PLANNER_E2E_PORT || 8181;
const dbDir = mkdtempSync(join(tmpdir(), 'planner-e2e-'));
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
    command: `cd .. && go build -o /tmp/planner-e2e-bin . && /tmp/planner-e2e-bin -addr 127.0.0.1:${PORT} -db ${process.env.PLANNER_E2E_DB}`,
    url: process.env.PLANNER_E2E_BASE + '/api/users',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
