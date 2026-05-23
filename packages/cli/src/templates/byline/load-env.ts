/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Loads `.env.local` and `.env` for tsx/node scripts that aren't invoked
 * through Vite's dev/build pipeline (seed scripts, one-shot tooling).
 * Mirrors Vite's precedence rule — `.env.local` wins for any duplicate
 * key — by listing it first; dotenv keeps the first occurrence and does
 * not override existing process.env values, so later files cannot trump
 * earlier ones.
 *
 * Must be imported as a side-effect BEFORE any module that reads
 * `process.env` (e.g. `server.config.ts`). Because ES module imports are
 * resolved post-order, the import statement
 *
 *     import './load-env.js'
 *
 * placed above `import './server.config.js'` guarantees this file's body
 * runs first.
 */

import { config } from 'dotenv'

config({ path: ['.env.local', '.env'], quiet: true })
