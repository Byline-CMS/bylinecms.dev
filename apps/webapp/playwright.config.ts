/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Playwright config for the admin editor smoke suite (see docs/TESTING.md →
 * "Editor smoke suite"). Browser-level happy paths over the document editor —
 * the regression net for the under-unit-tested surfaces (`@byline/admin`
 * forms/fields, host-adapter server fns, richtext) and for Lexical /
 * TanStack Start version bumps.
 *
 * Requirements: the dev Postgres up with `byline_dev` migrated and seeded
 * (`pnpm tsx byline/seed.ts`), and `.env.local` carrying the super-admin
 * credentials (`BYLINE_SUPERADMIN_EMAIL` / `BYLINE_SUPERADMIN_PASSWORD`).
 * The `webServer` block starts (or reuses) the Vite dev server on :5173.
 */

import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

// Same precedence as byline/load-env.ts — .env.local wins.
loadEnv({ path: ['.env.local', '.env'], quiet: true })

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  // The smoke flows mutate shared seeded documents — keep them serial.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
