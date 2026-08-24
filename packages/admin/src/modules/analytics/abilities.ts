/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AbilityRegistry } from '@byline/auth'

export const ANALYTICS_ABILITIES = {
  read: 'analytics.read',
  maintain: 'analytics.maintain',
} as const

export type AnalyticsAbilityKey = (typeof ANALYTICS_ABILITIES)[keyof typeof ANALYTICS_ABILITIES]

export function registerAnalyticsAbilities(registry: AbilityRegistry): void {
  registry.register({
    key: ANALYTICS_ABILITIES.read,
    label: 'Read analytics',
    description: 'View installation-level page, visitor, download, referrer, and country totals.',
    group: 'analytics',
    source: 'admin',
  })
  registry.register({
    key: ANALYTICS_ABILITIES.maintain,
    label: 'Maintain analytics',
    description: 'Delete retained analytics events and rebuild affected daily aggregates.',
    group: 'analytics',
    source: 'admin',
  })
}
