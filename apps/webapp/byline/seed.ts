/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Initialize Byline config by importing the server config
import 'dotenv/config'
import '../byline.server.config.js'

import { seedAdmin } from './seeds/admin.js'
import { seedCategories } from './seeds/categories.js'
import { seedDocuments } from './seeds/documents.js'

async function run() {
  await seedAdmin()
  await seedCategories()
  await seedDocuments()
}

run()
