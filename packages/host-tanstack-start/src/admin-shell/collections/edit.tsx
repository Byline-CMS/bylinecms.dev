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
import { getDefaultStatus, getWorkflowStatuses } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { useTranslation } from '@byline/i18n/react'
import { Container, Section, useToastManager } from '@byline/ui/react'

import {
  copyDocumentToLocale,
  deleteDocument,
  duplicateCollectionDocument,
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
  const { t } = useTranslation('byline-admin')
  const [_editState, setEditState] = useState<EditState>({
    status: 'idle',
    message: '',
  })
  const navigate = useNavigate()
  const { labels, path, fields } = collectionDefinition
  const singular = labels.singular
  const singularLower = singular.toLowerCase()

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
      const description = t('collections.edit.statusChangedDescription', { status })
      toastManager.add({
        title: t('collections.edit.statusUpdateTitle', { label: singular }),
        description,
        data: {
          intent: 'success',
          iconType: 'success',
          icon: true,
          close: true,
        },
      })
      setEditState({ status: 'success', message: description })
      // Refresh the page to reflect the new status.
      navigate({
        to: '/admin/collections/$collection/$id' as never,
        params: { collection: path, id: String(initialData.id) },
        search: (prev: Record<string, unknown>) => ({ ...prev }),
      })
    } catch (err) {
      console.error('Status change error:', err)
      const description = t('collections.edit.statusChangeFailedDescription', {
        message: (err as Error).message,
      })
      toastManager.add({
        title: t('collections.edit.statusUpdateTitle', { label: singular }),
        description,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })
      setEditState({ status: 'failed', message: description })
    }
  }

  // Published version metadata — attached by getCollectionDocument when a
  // published version exists behind the current draft.
  // biome-ignore lint/suspicious/noExplicitAny: storage shape
  const publishedVersion = (initialData as any)?._publishedVersion ?? null

  // Schema-mismatch warnings — attached by getCollectionDocument when the
  // document was loaded leniently (admin edit path) and at least one
  // orphan row was skipped because the collection schema has moved on
  // since the document was written.
  // biome-ignore lint/suspicious/noExplicitAny: storage shape
  const restoreWarnings = (initialData as any)?._restoreWarnings as string[] | undefined

  const handleUnpublish = async () => {
    try {
      await unpublishDocument({ data: { collection: path, id: String(initialData.id) } })
      const description = t('collections.edit.unpublishedDescription')
      toastManager.add({
        title: t('collections.edit.unpublishTitle', { label: singular }),
        description,
        data: {
          intent: 'success',
          iconType: 'success',
          icon: true,
          close: true,
        },
      })
      setEditState({ status: 'success', message: description })
      navigate({
        to: '/admin/collections/$collection/$id' as never,
        params: { collection: path, id: String(initialData.id) },
        search: (prev: Record<string, unknown>) => ({ ...prev }),
      })
    } catch (err) {
      console.error('Unpublish error:', err)
      const description = t('collections.edit.unpublishFailedDescription', {
        message: (err as Error).message,
      })
      toastManager.add({
        title: t('collections.edit.unpublishTitle', { label: singular }),
        description,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })
      setEditState({ status: 'failed', message: description })
    }
  }

  const handleDuplicate = async () => {
    try {
      const result = await duplicateCollectionDocument({
        data: { collection: path, id: String(initialData.id) },
      })
      const description = result.pathRetried
        ? t('collections.edit.duplicatedAutoPathDescription', { path: result.newPath })
        : t('collections.edit.duplicatedPathDescription', { path: result.newPath })
      toastManager.add({
        title: t('collections.edit.duplicatedTitle', { label: singular }),
        description,
        data: {
          intent: 'success',
          iconType: 'success',
          icon: true,
          close: true,
        },
      })
      setEditState({
        status: 'success',
        message: t('collections.edit.duplicatedSuccessMessage', { label: singular }),
      })
      // Navigate to the new document's edit view.
      navigate({
        to: '/admin/collections/$collection/$id' as never,
        params: { collection: path, id: result.documentId },
      })
    } catch (err) {
      console.error('Duplicate error:', err)
      const description = t('collections.edit.duplicateFailedDescription', {
        message: (err as Error).message,
      })
      toastManager.add({
        title: t('collections.edit.duplicateTitle', { label: singular }),
        description,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })
      setEditState({ status: 'failed', message: description })
    }
  }

  const handleCopyToLocale = async ({
    targetLocale,
    overwrite,
  }: {
    targetLocale: string
    overwrite: boolean
  }) => {
    try {
      const result = await copyDocumentToLocale({
        data: {
          collection: path,
          id: String(initialData.id),
          sourceLocale: locale ?? defaultContentLocale,
          targetLocale,
          overwrite,
        },
      })
      const sourceLabel =
        contentLocales.find((l) => l.code === result.sourceLocale)?.label ?? result.sourceLocale
      const targetLabel =
        contentLocales.find((l) => l.code === result.targetLocale)?.label ?? result.targetLocale
      const description =
        result.fieldsUpdated > 0
          ? t('collections.edit.copiedFieldsDescription', {
              count: result.fieldsUpdated,
              source: sourceLabel,
              target: targetLabel,
            })
          : t('collections.edit.copiedNoFieldsDescription', {
              source: sourceLabel,
              target: targetLabel,
            })
      toastManager.add({
        title: t('collections.edit.copyToLocaleTitle', { label: singular }),
        description,
        data: {
          intent: 'success',
          iconType: 'success',
          icon: true,
          close: true,
        },
      })
      setEditState({
        status: 'success',
        message: t('collections.edit.copiedSuccessMessage', {
          source: sourceLabel,
          target: targetLabel,
        }),
      })
      // Switch the form to the target locale so the editor sees the
      // copied content immediately.
      navigate({
        to: '/admin/collections/$collection/$id' as never,
        params: { collection: path, id: String(initialData.id) },
        search: { locale: targetLocale },
      })
    } catch (err) {
      console.error('Copy to locale error:', err)
      const description = t('collections.edit.copyFailedDescription', {
        message: (err as Error).message,
      })
      toastManager.add({
        title: t('collections.edit.copyToLocaleTitle', { label: singular }),
        description,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })
      setEditState({ status: 'failed', message: description })
    }
  }

  const handleDelete = async () => {
    try {
      await deleteDocument({ data: { collection: path, id: String(initialData.id) } })
      const description = t('collections.edit.deletedDescription', { label: singular })
      toastManager.add({
        title: t('collections.edit.deleteTitle', { label: singular }),
        description,
        data: {
          intent: 'success',
          iconType: 'success',
          icon: true,
          close: true,
        },
      })
      setEditState({ status: 'success', message: description })
      // Navigate back to the collection list after deletion.
      navigate({
        to: '/admin/collections/$collection' as never,
        params: { collection: path },
      })
    } catch (err) {
      console.error('Delete error:', err)
      const description = t('collections.edit.deleteFailedDescription', {
        message: (err as Error).message,
      })
      toastManager.add({
        title: t('collections.edit.deleteTitle', { label: singular }),
        description,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })
      setEditState({ status: 'failed', message: description })
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

      const description = t('collections.edit.updatedDescription', { label: singularLower })
      toastManager.add({
        title: t('collections.edit.updateTitle', { label: singular }),
        description,
        data: {
          intent: 'success',
          iconType: 'success',
          icon: true,
          close: true,
        },
      })

      setEditState({ status: 'success', message: description })

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
      const description = t('collections.edit.updateFailedDescription', { label: singularLower })
      toastManager.add({
        title: t('collections.edit.updateTitle', { label: singular }),
        description,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })

      setEditState({ status: 'failed', message: description })
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
          onDuplicate={handleDuplicate}
          onCopyToLocale={handleCopyToLocale}
          contentLocales={contentLocales}
          publishedVersion={publishedVersion}
          restoreWarnings={restoreWarnings}
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
