/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { assertAdminActor } from '@byline/admin'
import { ANALYTICS_ABILITIES } from '@byline/admin/analytics'
import { getAdminRequestContext } from '@byline/client/server'

export interface DeleteAnalyticsEventsInput {
  from: string
  to: string
  visitorHash?: string
}

export const deleteAnalyticsEvents = createServerFn({ method: 'POST' })
  .validator((input: DeleteAnalyticsEventsInput) => input)
  .handler(async ({ data }): Promise<{ deleted: number }> => {
    await assertAnalyticsMaintenance()
    const { getAnalytics } = await import('@byline/analytics')
    const from = parseInstant(data.from, 'from')
    const to = parseInstant(data.to, 'to')
    const deleted = await getAnalytics().deleteEvents({
      from,
      to,
      ...(data.visitorHash == null ? {} : { visitorHash: data.visitorHash }),
    })
    return { deleted }
  })

export const rebuildAnalyticsDay = createServerFn({ method: 'POST' })
  .validator((input: { day: string }) => input)
  .handler(async ({ data }): Promise<{ rebuilt: string }> => {
    await assertAnalyticsMaintenance()
    const { getAnalytics } = await import('@byline/analytics')
    await getAnalytics().rebuildDay(data.day)
    return { rebuilt: data.day }
  })

async function assertAnalyticsMaintenance(): Promise<void> {
  const context = await getAdminRequestContext()
  assertAdminActor(context, ANALYTICS_ABILITIES.maintain)
}

function parseInstant(value: string, label: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) throw new Error(`analytics ${label} must be an ISO instant`)
  return date
}
