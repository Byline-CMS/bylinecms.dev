/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineSingleton, SINGLE_STATUS_WORKFLOW } from '@byline/core'

/**
 * Operational site-wide values that have one logical document rather than a
 * list of entries. The single-status workflow publishes every save
 * immediately and keeps editorial workflow controls out of this form.
 */
export const SiteSettings = defineSingleton({
  path: 'site-settings',
  label: 'Site settings',
  workflow: SINGLE_STATUS_WORKFLOW,
  fields: [
    {
      name: 'siteName',
      label: 'Site name',
      type: 'text',
      helpText: 'The public name used when a page does not provide a more specific title.',
    },
    {
      name: 'siteDescription',
      label: 'Site description',
      type: 'textArea',
      localized: true,
      helpText: 'The default description used by search and social previews.',
      validation: { minLength: 50, maxLength: 160 },
    },
    {
      name: 'defaultImage',
      label: 'Default social image',
      type: 'image',
      optional: true,
      helpText: 'Fallback hero or social image for pages without their own image.',
      upload: {
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
        maxFileSize: 10 * 1024 * 1024,
        requireSavedDocument: true,
      },
    },
    {
      name: 'siteIcon',
      label: 'Site icon',
      type: 'image',
      optional: true,
      helpText: 'A square icon used for browser and application branding.',
      upload: {
        mimeTypes: ['image/png', 'image/webp', 'image/svg+xml'],
        maxFileSize: 2 * 1024 * 1024,
        requireSavedDocument: true,
      },
    },
  ],
})
