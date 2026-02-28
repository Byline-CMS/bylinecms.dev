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
import { getWorkflowStatuses } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { Container, Section, Toast } from '@infonomic/uikit/react'

import { lngParam, useLocale } from '@/i18n/hooks/use-locale-navigation'
import { FormRenderer } from '@/ui/fields/form-renderer'
import {
  deleteDocument,
  unpublishDocument,
  updateCollectionDocumentWithPatches,
  updateDocumentStatus,
} from '..'
import { ViewMenu } from './view-menu'

type EditState = {
  status: 'success' | 'failed' | 'busy' | 'idle'
  message: string
}

export const EditView = ({
  collectionDefinition,
  adminConfig,
  initialData,
  locale,
}: {
  collectionDefinition: CollectionDefinition
  adminConfig?: CollectionAdminConfig
  initialData: AnyCollectionSchemaTypes['UpdateType']
  locale?: string
}) => {
  const [toast, setToast] = useState(false)
  const [editState, setEditState] = useState<EditState>({
    status: 'idle',
    message: '',
  })
  const navigate = useNavigate()
  const uiLocale = useLocale()
  const { labels, path, fields } = collectionDefinition

  // Compute the next forward workflow status for the status button.
  const workflowStatuses = getWorkflowStatuses(collectionDefinition)
  const currentStatus = (initialData as any)?.status ?? 'draft'
  const currentIndex = workflowStatuses.findIndex((s) => s.name === currentStatus)
  const nextStatus =
    currentIndex !== -1 && currentIndex < workflowStatuses.length - 1
      ? workflowStatuses[currentIndex + 1]
      : undefined

  const handleLocaleChange = (newLocale: string) => {
    navigate({
      to: '/{-$lng}/admin/collections/$collection/$id',
      params: { ...lngParam(uiLocale), collection: path, id: String(initialData.document_id) },
      search: { locale: newLocale },
    })
  }

  const handleStatusChange = async (status: string) => {
    try {
      await updateDocumentStatus(path, String(initialData.document_id), status)
      setEditState({
        status: 'success',
        message: `Status changed to "${status}"`,
      })
      setToast(true)
      // Refresh the page to reflect the new status.
      navigate({
        to: '/{-$lng}/admin/collections/$collection/$id',
        params: { ...lngParam(uiLocale), collection: path, id: String(initialData.document_id) },
        search: (prev) => ({ ...prev }),
      })
    } catch (err) {
      console.error('Status change error:', err)
      setEditState({
        status: 'failed',
        message: `Failed to change status: ${(err as Error).message}`,
      })
      setToast(true)
    }
  }

  // Published version metadata — attached by getCollectionDocument when a
  // published version exists behind the current draft.
  const publishedVersion = (initialData as any)?._publishedVersion ?? null

  const handleUnpublish = async () => {
    try {
      await unpublishDocument(path, String(initialData.document_id))
      setEditState({
        status: 'success',
        message: 'Published version has been taken offline.',
      })
      setToast(true)
      navigate({
        to: '/{-$lng}/admin/collections/$collection/$id',
        params: { ...lngParam(uiLocale), collection: path, id: String(initialData.document_id) },
        search: (prev) => ({ ...prev }),
      })
    } catch (err) {
      console.error('Unpublish error:', err)
      setEditState({
        status: 'failed',
        message: `Failed to unpublish: ${(err as Error).message}`,
      })
      setToast(true)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteDocument(path, String(initialData.document_id))
      setEditState({
        status: 'success',
        message: `${labels.singular} has been deleted.`,
      })
      setToast(true)
      // Navigate back to the collection list after deletion.
      navigate({
        to: '/{-$lng}/admin/collections/$collection',
        params: { ...lngParam(uiLocale), collection: path },
      })
    } catch (err) {
      console.error('Delete error:', err)
      setEditState({
        status: 'failed',
        message: `Failed to delete: ${(err as Error).message}`,
      })
      setToast(true)
    }
  }

  const handleSubmit = async ({ data, patches }: { data: any; patches: any[] }) => {
    try {
      await updateCollectionDocumentWithPatches(
        path,
        String(initialData.document_id),
        data,
        patches,
        initialData.document_version_id as string | undefined,
        locale
      )

      setEditState({
        status: 'success',
        message: `Successfully updated ${labels.singular.toLowerCase()}`,
      })
      setToast(true)

      // Re-navigate to the same route so the loader re-fetches the document.
      // The new version will have a fresh version ID, draft status, and
      // updated publishedVersion metadata.
      navigate({
        to: '/{-$lng}/admin/collections/$collection/$id',
        params: { ...lngParam(uiLocale), collection: path, id: String(initialData.document_id) },
        search: (prev) => ({ ...prev }),
      })
    } catch (err) {
      console.error('Network error:', err)
      setEditState({
        status: 'failed',
        message: `An error occurred while updating ${labels.singular.toLowerCase()}`,
      })
      setToast(true)
    }
  }

  return (
    <>
      <Section>
        <Container>
          <FormRenderer
            mode="edit"
            fields={fields}
            onSubmit={handleSubmit}
            initialData={initialData}
            adminConfig={adminConfig}
            headingLabel={labels.singular}
            initialLocale={locale}
            onLocaleChange={handleLocaleChange}
            headerSlot={
              <ViewMenu
                collection={path}
                documentId={String(initialData.document_id)}
                activeView="edit"
                locale={locale}
              />
            }
            onStatusChange={handleStatusChange}
            onUnpublish={publishedVersion ? handleUnpublish : undefined}
            onDelete={handleDelete}
            publishedVersion={publishedVersion}
            nextStatus={nextStatus}
            workflowStatuses={workflowStatuses}
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
