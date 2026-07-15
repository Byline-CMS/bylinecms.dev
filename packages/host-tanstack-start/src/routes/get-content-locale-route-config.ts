/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { getClientConfig } from '@byline/core'

import type { ContentLocaleOption } from '../admin-shell/collections/view-menu.js'

export function getContentLocaleRouteConfig(): {
  contentLocales: ContentLocaleOption[]
  defaultContentLocale: string
} {
  const content = getClientConfig().i18n.content
  const labels = new Map(
    content.localeDefinitions?.map(({ code, nativeName }) => [code, nativeName]) ?? []
  )

  return {
    contentLocales: content.locales.map((code) => ({ code, label: labels.get(code) ?? code })),
    defaultContentLocale: content.defaultLocale,
  }
}
