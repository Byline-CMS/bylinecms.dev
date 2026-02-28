/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FormatterProps } from '@byline/core'

import { LocalDateTime } from '@/ui/components/local-date-time'

/**
 * SSR-safe date-time column formatter for list views.
 *
 * Uses the `LocalDateTime` component which renders a placeholder on the server
 * and formats to the user's locale/timezone after hydration, avoiding
 * server/client mismatches.
 */
export function DateTimeFormatter({ value }: FormatterProps) {
  return <LocalDateTime value={value} />
}
