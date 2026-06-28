/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * A `CollectionAdminConfig.listActions` component that rebuilds a collection's
 * search index. Register it on a searchable collection's admin config:
 *
 * ```ts
 * import { ReindexButton } from '@byline/host-tanstack-start/admin-shell/collections/reindex-button'
 * // CollectionAdminConfig:
 * listActions: [ReindexButton],
 * ```
 *
 * Permission-gated both ends: hidden unless the actor holds
 * `collections.<path>.reindex` (the same ability the server fn re-asserts).
 * Synchronous — fine for small/medium collections; a large corpus wants a
 * backgrounded job (see docs/05-reading-and-delivery/07-search.md).
 */

import type React from 'react'
import { useState } from 'react'

import type { ListActionComponentProps } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Button, useToastManager } from '@byline/ui/react'

import { useAbility } from '../../integrations/abilities.js'
import { reindexCollection } from '../../server-fns/collections/reindex.js'

export function ReindexButton({
  collectionPath,
}: ListActionComponentProps): React.JSX.Element | null {
  const { t } = useTranslation('byline-admin')
  const toastManager = useToastManager()
  const canReindex = useAbility(`collections.${collectionPath}.reindex`)
  const [pending, setPending] = useState(false)

  if (!canReindex) return null

  const onClick = async (): Promise<void> => {
    setPending(true)
    try {
      const report = await reindexCollection({ data: { collection: collectionPath } })
      toastManager.add({
        title: t('collections.list.reindexDoneTitle'),
        description: t('collections.list.reindexDoneDescription', { count: report.documents }),
        data: { intent: 'success', iconType: 'success', icon: true, close: true },
      })
    } catch {
      toastManager.add({
        title: t('collections.list.reindexFailedTitle'),
        data: { intent: 'danger', iconType: 'danger', icon: true, close: true },
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Button size="sm" variant="outlined" disabled={pending} onClick={onClick}>
      {pending ? t('collections.list.reindexPending') : t('collections.list.reindexLabel')}
    </Button>
  )
}
