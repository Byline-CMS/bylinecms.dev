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
import { seedDocs } from './seeds/docs.js'
import { seedFaqFixture } from './seeds/faq-fixture.js'
import { seedNewsCategories } from './seeds/news-categories.js'

async function run() {
  await seedAdmin()
  await seedNewsCategories()
  await seedDocs()
  await seedFaqFixture()
}

// Exit explicitly — the adapter's pool holds a live timer, so the process does
// not terminate on its own once the seed commits. See the fuller note in
// `seed-admin.ts`; the short version is that `pgAdapter`'s 2-second idle
// timeout masked this and mysql2's 60-second, non-unref'd idle sweep does not.
run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
