/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createCollectionHistoryRoute } from '@byline/host-tanstack-start/routes'

import { contentLocales, i18n } from '~/i18n'

export const Route = createCollectionHistoryRoute(
  '/(byline)/admin/collections/$collection/$id/history',
  {
    contentLocales,
    defaultContentLocale: i18n.content.defaultLocale,
  }
)
