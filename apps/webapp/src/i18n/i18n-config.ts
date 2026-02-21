/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// https://github.com/vercel/next.js/tree/canary/examples/app-dir-i18n-routing
export const i18nConfig = {
  locales: ['en', 'es'],
  defaultLocale: 'en',
  cookieName: 'lng',
} as const

export type Locale = (typeof i18nConfig)['locales'][number]
