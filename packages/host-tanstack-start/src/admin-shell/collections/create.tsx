/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import { FormRenderer } from '@byline/admin/react'
import type { CollectionAdminConfig, CollectionDefinition } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Container, Section, useToastManager } from '@byline/ui/react'

import { getAdminRoutePath } from '../../routes/admin-path.js'
import { createCollectionDocument } from '../../server-fns/collections/index.js'
import { useNavigate } from '../chrome/loose-router.js'
import { useTanStackNavigationGuard } from './tanstack-navigation-guard.js'

type CreateState = {
  status: 'success' | 'failed' | 'busy' | 'idle'
  message: string
}

export const CreateView = ({
  collectionDefinition,
  adminConfig,
  initialData,
}: {
  collectionDefinition: CollectionDefinition
  adminConfig?: CollectionAdminConfig
  // biome-ignore lint/suspicious/noExplicitAny: shape is collection-specific
  initialData?: Record<string, any>
}) => {
  const toastManager = useToastManager()
  const { t } = useTranslation('byline-admin')
  const [_createState, setCreateState] = useState<CreateState>({
    status: 'idle',
    message: '',
  })
  const navigate = useNavigate()
  const { labels, path, fields } = collectionDefinition

  const handleSubmit = async ({
    data,
    systemPath,
    systemAvailableLocales,
  }: {
    // biome-ignore lint/suspicious/noExplicitAny: data is collection-specific
    data: any
    systemPath?: string | null
    systemAvailableLocales?: string[]
  }) => {
    try {
      const result = await createCollectionDocument({
        data: {
          collection: path,
          data,
          ...(systemPath ? { path: systemPath } : {}),
          ...(systemAvailableLocales ? { availableLocales: systemAvailableLocales } : {}),
        },
      })
      // Create → edit: land the editor on the new document, where the rest
      // of the work (content, status, relations) happens. The list-view
      // fallback covers callers running against an older server fn that
      // doesn't return the new document's id.
      if (result?.documentId) {
        navigate({
          to: getAdminRoutePath('collections', '$collection', '$id'),
          params: { collection: path, id: result.documentId } as never,
          search: { action: 'created' },
        })
      } else {
        navigate({
          to: getAdminRoutePath('collections', '$collection'),
          params: { collection: path },
          search: { action: 'created' },
        })
      }
    } catch (err) {
      console.error(err)

      const description = t('collections.create.errorToastDescription', {
        label: labels.singular.toLowerCase(),
      })
      toastManager.add({
        title: t('collections.create.errorToastTitle', { label: labels.singular }),
        description,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })

      setCreateState({
        status: 'failed',
        message: description,
      })
    }
  }

  return (
    <Section>
      <Container>
        <FormRenderer
          mode="create"
          fields={fields}
          onSubmit={handleSubmit}
          initialData={initialData}
          adminConfig={adminConfig}
          useAsTitle={collectionDefinition.useAsTitle}
          useAsPath={collectionDefinition.useAsPath}
          advertiseLocales={collectionDefinition.advertiseLocales}
          headingLabel={labels.singular}
          useNavigationGuard={useTanStackNavigationGuard}
          onCancel={() =>
            navigate({
              to: getAdminRoutePath('collections', '$collection'),
              params: { collection: path },
            })
          }
          collectionPath={path}
        />
      </Container>
    </Section>
  )
}
