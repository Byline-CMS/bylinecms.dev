/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Initialize Byline config by importing the server config
import './load-env.js'
import './server.config.js'

import { seedAdmin } from './seeds/admin.js'

async function run() {
  await seedAdmin()
}

// Exit explicitly rather than waiting for the event loop to drain. The
// configured adapter's connection pool holds a live timer, so the process
// stays alive long after the seed has committed:
//
//   • `pgAdapter` defaults `idleTimeoutMillis: 2000`, so on Postgres the pool
//     goes quiet after ~2s and the script appeared to exit on its own.
//   • `mysqlAdapter` leaves mysql2's defaults in place — `idleTimeout` 60s with
//     `maxIdle` equal to `connectionLimit` — and mysql2's idle-sweep timer is
//     not unref'd, so the script looks frozen even though the work is done.
//
// The `.catch` also matters: `run()` was previously called bare, so a rejected
// seed surfaced as an unhandled rejection rather than a non-zero exit.
run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
