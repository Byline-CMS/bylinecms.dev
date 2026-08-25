/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { config as loadEnv } from 'dotenv'

/**
 * Vitest `setupFiles`: runs in the worker once per test file, before the
 * test module is imported. That ordering matters here — the integration
 * suite calls `requiredEnv()` at module scope while building its
 * `configurations` array, so the variables have to be present before the
 * import, not merely before the first test.
 *
 * `dotenv` does not overwrite variables that are already set, so CI keeps
 * winning: the workflow supplies both admin URLs through the job-level
 * `env:` block and never writes a `.env.test` for this package.
 *
 * Unlike the adapter packages, these are *admin* connection strings — the
 * suite creates and drops its own `*_test` databases and roles — so they
 * are deliberately separate from `BYLINE_DB_*_CONNECTION_STRING`.
 */
loadEnv({ path: '.env.test' })
