/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import type { CollectionAdminConfig, CollectionDefinition } from '@byline/core'
import { Container, Section, useToastManager } from '@infonomic/uikit/react'

import { lngParam, useLocale } from '@/i18n/hooks/use-locale-navigation'
import { FormRenderer } from '@/ui/forms/form-renderer'
import { useTanStackNavigationGuard } from '@/ui/forms/tanstack-navigation-guard'
import { createCollectionDocument } from '..'

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
  initialData?: Record<string, any>
}) => {
  const toastManager = useToastManager()
  const [_createState, setCreateState] = useState<CreateState>({
    status: 'idle',
    message: '',
  })
  const navigate = useNavigate()
  const uiLocale = useLocale()
  const { labels, path, fields } = collectionDefinition

  const handleSubmit = async ({ data }: { data: any }) => {
    try {
      await createCollectionDocument({ data: { collection: path, data } })
      navigate({
        to: '/{-$lng}/admin/collections/$collection',
        params: { ...lngParam(uiLocale), collection: path },
        search: { action: 'created' },
      })
    } catch (err) {
      console.error(err)

      toastManager.add({
        title: `${labels.singular} Creation`,
        description: `An error occurred while creating ${labels.singular.toLowerCase()}`,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })

      setCreateState({
        status: 'failed',
        message: `An error occurred while creating ${labels.singular.toLowerCase()}`,
      })
    }
  }

  return (
    <Section>
      <Container>
        {/* <h2 className="mb-2">Create {labels.singular}</h2> */}
        <FormRenderer
          mode="create"
          fields={fields}
          onSubmit={handleSubmit}
          initialData={initialData}
          adminConfig={adminConfig}
          headingLabel={labels.singular}
          useNavigationGuard={useTanStackNavigationGuard}
          onCancel={() =>
            navigate({
              to: '/{-$lng}/admin/collections/$collection',
              params: { ...lngParam(uiLocale), collection: path },
            })
          }
          collectionPath={path}
        />
      </Container>
    </Section>
  )
}
