/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import type { CollectionAdminConfig, CollectionDefinition } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { Button, Container, HistoryIcon, IconButton, Section, Toast } from '@infonomic/uikit/react'

import { FormRenderer } from '@/ui/fields/form-renderer'
import { updateCollectionDocumentWithPatches } from '../data'

type EditState = {
  status: 'success' | 'failed' | 'busy' | 'idle'
  message: string
}

export const EditView = ({
  collectionDefinition,
  adminConfig,
  initialData,
}: {
  collectionDefinition: CollectionDefinition
  adminConfig?: CollectionAdminConfig
  initialData: AnyCollectionSchemaTypes['UpdateType']
}) => {
  const [toast, setToast] = useState(false)
  const [editState, setEditState] = useState<EditState>({
    status: 'idle',
    message: '',
  })
  const navigate = useNavigate()
  const { labels, path, fields } = collectionDefinition

  const handleSubmit = async ({ data, patches }: { data: any; patches: any[] }) => {
    try {
      await updateCollectionDocumentWithPatches(
        path,
        String(initialData.document_id),
        data,
        patches,
        initialData.document_version_id as string | undefined
      )

      setEditState({
        status: 'success',
        message: `Successfully updated ${labels.singular.toLowerCase()}`,
      })
    } catch (err) {
      console.error('Network error:', err)
      setEditState({
        status: 'failed',
        message: `An error occurred while updating ${labels.singular.toLowerCase()}`,
      })
    }
    setToast(true)
  }

  return (
    <>
      <Section>
        <Container>
          <div className="item-view flex flex-col sm:flex-row justify-start sm:justify-between">
            <h2 className="mb-2">Edit {labels.singular}</h2>
            <div className="flex items-center gap-2 pb-4 sm:pb-2">
              <IconButton
                className="min-w-[24px] min-h-[24px]"
                size="sm"
                variant="text"
                onClick={() =>
                  navigate({
                    to: '/admin/collections/$collection/$id/history',
                    params: { collection: path, id: String(initialData.document_id) },
                  })
                }
              >
                <HistoryIcon className="w-4 h-4" />
              </IconButton>
              <Button
                size="sm"
                variant="filled"
                className="min-w-[50px] min-h-[28px]"
                onClick={() =>
                  navigate({
                    to: '/admin/collections/$collection/$id',
                    params: { collection: path, id: String(initialData.document_id) },
                  })
                }
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outlined"
                className="min-w-[50px] min-h-[28px]"
                onClick={() =>
                  navigate({
                    to: '/admin/collections/$collection/$id/api',
                    params: { collection: path, id: String(initialData.document_id) },
                  })
                }
              >
                API
              </Button>
            </div>
          </div>
          <FormRenderer
            fields={fields}
            onSubmit={handleSubmit}
            initialData={initialData}
            adminConfig={adminConfig}
            onCancel={() =>
              navigate({ to: '/admin/collections/$collection', params: { collection: path } })
            }
          />
        </Container>
      </Section>
      <Toast
        title={`${labels.singular} Update`}
        iconType={editState.status === 'success' ? 'success' : 'danger'}
        intent={editState.status === 'success' ? 'success' : 'danger'}
        position="bottom-right"
        message={editState.message}
        open={toast}
        onOpenChange={setToast}
      />
    </>
  )
}
