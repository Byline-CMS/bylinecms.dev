/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import type { CollectionAdminConfig, CollectionDefinition } from '@byline/core'
import { getDefaultStatus, getWorkflowStatuses } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { FormRenderer } from '@byline/ui'
import { Container, Section, useToastManager } from '@infonomic/uikit/react'

import {
  deleteDocument,
  unpublishDocument,
  updateCollectionDocumentWithPatches,
  updateDocumentStatus,
} from '../../server-fns/collections/index.js'
import { useNavigate } from '../chrome/loose-router.js'
import { useTanStackNavigationGuard } from './tanstack-navigation-guard.js'
import { ViewMenu } from './view-menu.js'
import type { ContentLocaleOption } from './view-menu.js'

type EditState = {
  status: 'success' | 'failed' | 'busy' | 'idle'
  message: string
}

export const EditView = ({
  collectionDefinition,
  adminConfig,
  initialData,
  locale,
  contentLocales,
  defaultContentLocale,
}: {
  collectionDefinition: CollectionDefinition
  adminConfig?: CollectionAdminConfig
  initialData: AnyCollectionSchemaTypes['UpdateType']
  locale?: string
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
}) => {
  const toastManager = useToastManager()
  const [_editState, setEditState] = useState<EditState>({
    status: 'idle',
    message: '',
  })
  const navigate = useNavigate()
  const { labels, path, fields } = collectionDefinition

  // Compute the next forward workflow status for the status button.
  const workflowStatuses = getWorkflowStatuses(collectionDefinition)
  // biome-ignore lint/suspicious/noExplicitAny: storage shape
  const currentStatus = (initialData as any)?.status ?? getDefaultStatus(collectionDefinition)
  const currentIndex = workflowStatuses.findIndex((s) => s.name === currentStatus)
  const nextStatus =
    currentIndex !== -1 && currentIndex < workflowStatuses.length - 1
      ? workflowStatuses[currentIndex + 1]
      : undefined

  const handleLocaleChange = (newLocale: string) => {
    navigate({
      to: '/admin/collections/$collection/$id' as never,
      params: { collection: path, id: String(initialData.id) },
      search: { locale: newLocale },
    })
  }

  const handleStatusChange = async (status: string) => {
    try {
      await updateDocumentStatus({
        data: { collection: path, id: String(initialData.id), status },
      })
      toastManager.add({
        title: `${labels.singular} Status Update`,
        description: `Status changed to "${status}"`,
        data: {
          intent: 'success',
          iconType: 'success',
          icon: true,
          close: true,
        },
      })
      setEditState({
        status: 'success',
        message: `Status changed to "${status}"`,
      })
      // Refresh the page to reflect the new status.
      navigate({
        to: '/admin/collections/$collection/$id' as never,
        params: { collection: path, id: String(initialData.id) },
        search: (prev: Record<string, unknown>) => ({ ...prev }),
      })
    } catch (err) {
      console.error('Status change error:', err)
      toastManager.add({
        title: `${labels.singular} Status Update`,
        description: `Failed to change status: ${(err as Error).message}`,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })
      setEditState({
        status: 'failed',
        message: `Failed to change status: ${(err as Error).message}`,
      })
    }
  }

  // Published version metadata — attached by getCollectionDocument when a
  // published version exists behind the current draft.
  // biome-ignore lint/suspicious/noExplicitAny: storage shape
  const publishedVersion = (initialData as any)?._publishedVersion ?? null

  const handleUnpublish = async () => {
    try {
      await unpublishDocument({ data: { collection: path, id: String(initialData.id) } })
      toastManager.add({
        title: `${labels.singular} Unpublish`,
        description: 'Published version has been taken offline.',
        data: {
          intent: 'success',
          iconType: 'success',
          icon: true,
          close: true,
        },
      })
      setEditState({
        status: 'success',
        message: 'Published version has been taken offline.',
      })
      navigate({
        to: '/admin/collections/$collection/$id' as never,
        params: { collection: path, id: String(initialData.id) },
        search: (prev: Record<string, unknown>) => ({ ...prev }),
      })
    } catch (err) {
      console.error('Unpublish error:', err)
      toastManager.add({
        title: `${labels.singular} Unpublish`,
        description: `Failed to unpublish: ${(err as Error).message}`,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })
      setEditState({
        status: 'failed',
        message: `Failed to unpublish: ${(err as Error).message}`,
      })
    }
  }

  const handleDelete = async () => {
    try {
      await deleteDocument({ data: { collection: path, id: String(initialData.id) } })
      toastManager.add({
        title: `${labels.singular} Deletion`,
        description: `${labels.singular} has been deleted.`,
        data: {
          intent: 'success',
          iconType: 'success',
          icon: true,
          close: true,
        },
      })
      setEditState({
        status: 'success',
        message: `${labels.singular} has been deleted.`,
      })
      // Navigate back to the collection list after deletion.
      navigate({
        to: '/admin/collections/$collection' as never,
        params: { collection: path },
      })
    } catch (err) {
      console.error('Delete error:', err)
      toastManager.add({
        title: `${labels.singular} Deletion`,
        description: `Failed to delete: ${(err as Error).message}`,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })
      setEditState({
        status: 'failed',
        message: `Failed to delete: ${(err as Error).message}`,
      })
    }
  }

  const handleSubmit = async ({
    data: _data,
    patches,
    systemPath,
  }: {
    // biome-ignore lint/suspicious/noExplicitAny: data is collection-specific
    data: any
    // biome-ignore lint/suspicious/noExplicitAny: patches list shape
    patches: any[]
    systemPath?: string | null
  }) => {
    try {
      await updateCollectionDocumentWithPatches({
        data: {
          collection: path,
          id: String(initialData.id),
          patches,
          versionId: initialData.versionId as string | undefined,
          locale,
          ...(systemPath ? { path: systemPath } : {}),
        },
      })

      toastManager.add({
        title: `${labels.singular} Update`,
        description: `Successfully updated ${labels.singular.toLowerCase()}`,
        data: {
          intent: 'success',
          iconType: 'success',
          icon: true,
          close: true,
        },
      })

      setEditState({
        status: 'success',
        message: `Successfully updated ${labels.singular.toLowerCase()}`,
      })

      // Re-navigate to the same route so the loader re-fetches the document.
      // The new version will have a fresh version ID, draft status, and
      // updated publishedVersion metadata.
      navigate({
        to: '/admin/collections/$collection/$id' as never,
        params: { collection: path, id: String(initialData.id) },
        search: (prev: Record<string, unknown>) => ({ ...prev }),
      })
    } catch (err) {
      console.error('Network error:', err)
      toastManager.add({
        title: `${labels.singular} Update`,
        description: `An error occurred while updating ${labels.singular.toLowerCase()}`,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })

      setEditState({
        status: 'failed',
        message: `An error occurred while updating ${labels.singular.toLowerCase()}`,
      })
    }
  }

  return (
    <Section>
      <Container>
        <FormRenderer
          mode="edit"
          fields={fields}
          onSubmit={handleSubmit}
          initialData={initialData}
          adminConfig={adminConfig}
          useAsTitle={collectionDefinition.useAsTitle}
          useAsPath={collectionDefinition.useAsPath}
          headingLabel={labels.singular}
          initialLocale={locale}
          onLocaleChange={handleLocaleChange}
          useNavigationGuard={useTanStackNavigationGuard}
          headerSlot={
            <ViewMenu
              collection={path}
              documentId={String(initialData.id)}
              activeView="edit"
              locale={locale}
              contentLocales={contentLocales}
              defaultContentLocale={defaultContentLocale}
              adminConfig={adminConfig}
              // initialData is the loaded ClientDocument-shaped record (id +
              // path + status + fields) — exactly what PreviewDocument needs.
              // biome-ignore lint/suspicious/noExplicitAny: storage shape
              doc={initialData as any}
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
              to: '/admin/collections/$collection' as never,
              params: { collection: path },
            })
          }
          collectionPath={path}
        />
      </Container>
    </Section>
  )
}
