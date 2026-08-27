/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { getSystemBylineClient } from '@byline/client/server'

/** Seed the singleton slot once, without overwriting later editorial changes. */
export async function seedSiteSettings(): Promise<'seeded' | 'unchanged'> {
  const settings = getSystemBylineClient().singleton('site-settings')
  const existing = await settings.get({ status: 'any' })
  if (existing != null) return 'unchanged'

  await settings.update({
    siteName: 'Example site',
    siteDescription:
      'A concise description of this site for search results and social media previews.',
  })
  console.log('Seeded site settings')
  return 'seeded'
}
