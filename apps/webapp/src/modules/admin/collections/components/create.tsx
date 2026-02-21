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
import { Container, Section, Toast } from '@infonomic/uikit/react'

import { FormRenderer } from '@/ui/fields/form-renderer'
import { createCollectionDocument } from '../data'

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
  const [toast, setToast] = useState(false)
  const [createState, setCreateState] = useState<CreateState>({
    status: 'idle',
    message: '',
  })
  const navigate = useNavigate()
  const { labels, path, fields } = collectionDefinition
  // const location = useRouterState({ select: (s) => s.location })

  const handleSubmit = async ({ data }: { data: any }) => {
    try {
      await createCollectionDocument(path, data)
      navigate({
        to: '/admin/collections/$collection',
        params: { collection: path },
        search: { action: 'created' },
      })
    } catch (err) {
      console.error(err)
      setCreateState({
        status: 'failed',
        message: `An error occurred while creating ${labels.singular.toLowerCase()}`,
      })
      setToast(true)
    }
  }

  return (
    <>
      <Section>
        <Container>
          <h2 className="mb-2">Create {labels.singular}</h2>
          <FormRenderer
            fields={fields}
            onSubmit={handleSubmit}
            onCancel={() =>
              navigate({
                to: '/admin/collections/$collection',
                params: { collection: path },
              })
            }
            initialData={initialData}
            adminConfig={adminConfig}
          />
        </Container>
      </Section>
      <Toast
        title={`${labels.singular} Creation`}
        iconType={createState.status === 'success' ? 'success' : 'danger'}
        intent={createState.status === 'success' ? 'success' : 'danger'}
        position="bottom-right"
        message={createState.message}
        open={toast}
        onOpenChange={setToast}
      />
    </>
  )
}
