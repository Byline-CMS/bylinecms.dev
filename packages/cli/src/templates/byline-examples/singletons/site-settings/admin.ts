/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineSingletonAdmin, type SingletonAdminConfig } from '@byline/core'

import { SiteSettings } from './schema.js'

export const SiteSettingsAdmin: SingletonAdminConfig = defineSingletonAdmin(SiteSettings, {
  group: 'settings',
  tabSets: [
    {
      name: 'settingsTabs',
      tabs: [
        {
          name: 'general',
          label: 'General',
          fields: ['siteName', 'siteDescription'],
        },
        {
          name: 'sharing',
          label: 'Social sharing',
          fields: ['defaultImage', 'siteIcon'],
        },
      ],
    },
  ],
  layout: { main: ['settingsTabs'] },
  preview: { url: () => '/' },
})
