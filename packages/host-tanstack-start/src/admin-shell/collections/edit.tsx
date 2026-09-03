/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import { FormRenderer } from '@byline/admin/react'
import type { CollectionAdminConfig, MultiCollectionDefinition } from '@byline/core'
import {
  getDefaultStatus,
  getWorkflow,
  getWorkflowStatuses,
  validateStatusTransition,
} from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { useTranslation } from '@byline/i18n/react'
import { Container, Section, useToastManager } from '@byline/ui/react'

import { getAdminRoutePath } from '../../routes/admin-path.js'
import { clearListReturnState } from '../../routes/list-return-storage.js'
import {
  cancelCollectionDocumentScheduledPublish,
  confirmCollectionDocumentScheduledPublish,
  copyDocumentToLocale,
  deleteDocument,
  deleteDocumentLocale,
  duplicateCollectionDocument,
  hasCommittedDocumentHookFailure,
  hasDeleteSideEffectFailures,
  scheduleCollectionDocumentPublish,
  unpublishDocument,
  updateCollectionDocumentSystemFields,
  updateCollectionDocumentWithPatches,
  updateDocumentStatus,
} from '../../server-fns/collections/index.js'
import { useNavigate } from '../chrome/loose-router.js'
import { useTanStackNavigationGuard } from './tanstack-navigation-guard.js'
import { ViewMenu } from './view-menu.js'
import type { SerializedDocumentPublishSchedule } from '../../server-fns/collections/index.js'
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
  returnSearch,
}: {
  collectionDefinition: MultiCollectionDefinition
  adminConfig?: CollectionAdminConfig
  initialData: AnyCollectionSchemaTypes['UpdateType']
  locale?: string
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
  /** URL-encoded list search state to return to on close — see list-return-state.ts. */
  returnSearch?: Record<string, unknown>
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
  const scheduledPublicationEnabled =
    // biome-ignore lint/suspicious/noExplicitAny: host-only loader metadata
    (initialData as any)?._scheduledPublicationEnabled === true
  const canSchedulePublication =
    // biome-ignore lint/suspicious/noExplicitAny: host-only loader metadata
    (initialData as any)?._canSchedulePublication === true
  // biome-ignore lint/suspicious/noExplicitAny: host-only loader metadata
  const scheduledPublication = ((initialData as any)?._scheduledPublish ??
    null) as SerializedDocumentPublishSchedule | null
  const publishTransitionValid =
    currentStatus !== 'published' &&
    getWorkflowStatuses(collectionDefinition).length > 1 &&
    validateStatusTransition(getWorkflow(collectionDefinition), currentStatus, 'published').valid
  const canArmSchedule =
    scheduledPublicationEnabled && canSchedulePublication && publishTransitionValid

  const notifyScheduleSuspended = () => {
    if (scheduledPublication?.state !== 'armed') return
    toastManager.add({
      title: t('scheduledPublication.toast.suspendedTitle'),
      description: t('scheduledPublication.toast.suspendedDescription'),
      data: { intent: 'warning', iconType: 'warning', icon: true, close: true },
    })
  }

  const handleLocaleChange = (newLocale: string) => {
    navigate({
      to: getAdminRoutePath('collections', '$collection', '$id'),
      params: { collection: path, id: String(initialData.id) },
      search: (prev: Record<string, unknown>) => ({ ...prev, locale: newLocale }),
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
        to: getAdminRoutePath('collections', '$collection', '$id'),
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

  const reloadDocument = () => {
    navigate({
      to: getAdminRoutePath('collections', '$collection', '$id'),
      params: { collection: path, id: String(initialData.id) },
      search: (prev: Record<string, unknown>) => ({ ...prev }),
    })
  }

  const handleSchedulePublication = async ({ publishAt }: { publishAt: string }) => {
    try {
      await scheduleCollectionDocumentPublish({
        data: {
          collection: path,
          id: String(initialData.id),
          publishAt,
          expectedVersionId: String(initialData.versionId),
        },
      })
      toastManager.add({
        title: t('scheduledPublication.toast.scheduledTitle'),
        description: t('scheduledPublication.toast.scheduledDescription'),
        data: { intent: 'success', iconType: 'success', icon: true, close: true },
      })
      reloadDocument()
    } catch (err) {
      toastManager.add({
        title: t('scheduledPublication.toast.failedTitle'),
        description: (err as Error).message,
        data: { intent: 'danger', iconType: 'danger', icon: true, close: true },
      })
      throw err
    }
  }

  const handleConfirmScheduledPublication = async () => {
    try {
      await confirmCollectionDocumentScheduledPublish({
        data: {
          collection: path,
          id: String(initialData.id),
          expectedVersionId: String(initialData.versionId),
        },
      })
      toastManager.add({
        title: t('scheduledPublication.toast.confirmedTitle'),
        description: t('scheduledPublication.toast.confirmedDescription'),
        data: { intent: 'success', iconType: 'success', icon: true, close: true },
      })
      reloadDocument()
    } catch (err) {
      toastManager.add({
        title: t('scheduledPublication.toast.failedTitle'),
        description: (err as Error).message,
        data: { intent: 'danger', iconType: 'danger', icon: true, close: true },
      })
      throw err
    }
  }

  const handleCancelScheduledPublication = async () => {
    try {
      const result = await cancelCollectionDocumentScheduledPublish({
        data: { collection: path, id: String(initialData.id) },
      })
      const cancelled = result.status === 'cancelled'
      toastManager.add({
        title: cancelled
          ? t('scheduledPublication.toast.cancelledTitle')
          : t('scheduledPublication.toast.cancelLostTitle'),
        description: cancelled
          ? t('scheduledPublication.toast.cancelledDescription')
          : t('scheduledPublication.toast.cancelLostDescription'),
        data: {
          intent: cancelled ? 'success' : 'warning',
          iconType: cancelled ? 'success' : 'warning',
          icon: true,
          close: true,
        },
      })
      reloadDocument()
    } catch (err) {
      toastManager.add({
        title: t('scheduledPublication.toast.failedTitle'),
        description: (err as Error).message,
        data: { intent: 'danger', iconType: 'danger', icon: true, close: true },
      })
      throw err
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
        to: getAdminRoutePath('collections', '$collection', '$id'),
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
      // Navigate to the new document's edit view. Threads the current
      // search (including `from`) forward so closing the duplicate
      // returns to the originating list.
      navigate({
        to: getAdminRoutePath('collections', '$collection', '$id'),
        params: { collection: path, id: result.documentId },
        search: (prev: Record<string, unknown>) => ({ ...prev }),
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
      notifyScheduleSuspended()
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
        to: getAdminRoutePath('collections', '$collection', '$id'),
        params: { collection: path, id: String(initialData.id) },
        search: (prev: Record<string, unknown>) => ({ ...prev, locale: targetLocale }),
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

  const handleDeleteLocale = async ({ targetLocale }: { targetLocale: string }) => {
    try {
      const result = await deleteDocumentLocale({
        data: {
          collection: path,
          id: String(initialData.id),
          locale: targetLocale,
        },
      })
      const targetLabel =
        contentLocales.find((l) => l.code === result.locale)?.label ?? result.locale
      const description = t('collections.edit.deletedLocaleDescription', {
        label: singular,
        locale: targetLabel,
      })
      toastManager.add({
        title: t('collections.edit.deleteLocaleTitle', { label: singular }),
        description,
        data: {
          intent: 'success',
          iconType: 'success',
          icon: true,
          close: true,
        },
      })
      notifyScheduleSuspended()
      setEditState({ status: 'success', message: description })
      // The deleted locale may be the one being viewed — land on the default
      // locale (which always survives) so the loader re-fetches a valid view.
      navigate({
        to: getAdminRoutePath('collections', '$collection', '$id'),
        params: { collection: path, id: String(initialData.id) },
        search: (prev: Record<string, unknown>) => ({ ...prev, locale: defaultContentLocale }),
      })
    } catch (err) {
      console.error('Delete locale error:', err)
      const description = t('collections.edit.deleteLocaleFailedDescription', {
        message: (err as Error).message,
      })
      toastManager.add({
        title: t('collections.edit.deleteLocaleTitle', { label: singular }),
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
      const result = await deleteDocument({
        data: { collection: path, id: String(initialData.id) },
      })
      const hasSideEffectFailures = hasDeleteSideEffectFailures(result)
      const description = hasSideEffectFailures
        ? t('collections.edit.deletedWithWarningsDescription', { label: singular })
        : t('collections.edit.deletedDescription', { label: singular })
      toastManager.add({
        title: t('collections.edit.deleteTitle', { label: singular }),
        description,
        data: {
          intent: hasSideEffectFailures ? 'warning' : 'success',
          iconType: hasSideEffectFailures ? 'warning' : 'success',
          icon: true,
          close: true,
        },
      })
      setEditState({ status: 'success', message: description })
      // Navigate back to the collection list after deletion. The return
      // target has now been consumed — clear the stored fallback so a later
      // visit doesn't resurrect a stale list position.
      clearListReturnState(path, String(initialData.id))
      navigate({
        to: getAdminRoutePath('collections', '$collection'),
        params: { collection: path },
        search: returnSearch,
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
    contentDirty,
    pathDirty,
    systemPath,
    availableLocalesDirty,
    systemAvailableLocales,
  }: {
    // biome-ignore lint/suspicious/noExplicitAny: data is collection-specific
    data: any
    // biome-ignore lint/suspicious/noExplicitAny: patches list shape
    patches: any[]
    /** Document field data / patches changed → versioned write. */
    contentDirty: boolean
    /** Path widget changed → non-versioned direct write. */
    pathDirty: boolean
    systemPath?: string | null
    /** Available-locales widget changed → non-versioned direct write. */
    availableLocalesDirty: boolean
    systemAvailableLocales?: string[]
  }) => {
    try {
      let hookFailed = false
      // Document-grain system fields write first via their own non-versioned
      // path — so a path conflict surfaces before we mint a content version,
      // and these immediate writes never reset workflow status. See
      // docs/08-internationalization/index.md.
      if (pathDirty || availableLocalesDirty) {
        await updateCollectionDocumentSystemFields({
          data: {
            collection: path,
            id: String(initialData.id),
            locale,
            ...(pathDirty ? { path: systemPath ?? null } : {}),
            ...(availableLocalesDirty ? { availableLocales: systemAvailableLocales ?? [] } : {}),
          },
        })
      }

      // Content (field data / patches) follows the normal versioned path —
      // mints a new draft version. Skipped entirely when only the system
      // fields changed, so a path/advertising edit never creates an empty
      // content version.
      if (contentDirty) {
        const result = await updateCollectionDocumentWithPatches({
          data: {
            collection: path,
            id: String(initialData.id),
            patches,
            versionId: initialData.versionId as string | undefined,
            locale,
          },
        })
        hookFailed = hasCommittedDocumentHookFailure(result)
      }

      if (contentDirty && scheduledPublication?.state === 'armed') {
        notifyScheduleSuspended()
      }

      const description = hookFailed
        ? t('collections.save.hookFailedDescription')
        : t('collections.edit.updatedDescription', { label: singularLower })
      toastManager.add({
        title: hookFailed
          ? t('collections.save.hookFailedToast')
          : t('collections.edit.updateTitle', { label: singular }),
        description,
        data: {
          intent: hookFailed ? 'warning' : 'success',
          iconType: hookFailed ? 'warning' : 'success',
          icon: true,
          close: true,
        },
      })

      setEditState({ status: 'success', message: description })

      // Re-navigate to the same route so the loader re-fetches the document.
      // The new version will have a fresh version ID, the collection's default
      // workflow status, and updated publishedVersion metadata.
      navigate({
        to: getAdminRoutePath('collections', '$collection', '$id'),
        params: { collection: path, id: String(initialData.id) },
        search: (prev: Record<string, unknown>) => ({ ...prev }),
        // Every write above has succeeded. FormRenderer clears its dirty
        // baseline after this handler returns, so bypass the guard during the
        // intentional post-save refresh rather than racing that state update.
        ignoreBlocker: true,
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

      // Rethrow so FormRenderer keeps the form dirty. The toast above has
      // already told the editor what went wrong.
      throw err
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
          advertiseLocales={collectionDefinition.advertiseLocales}
          tree={collectionDefinition.tree === true}
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
          scheduledPublication={scheduledPublication}
          onSchedulePublication={canArmSchedule ? handleSchedulePublication : undefined}
          onConfirmScheduledPublication={
            canArmSchedule && scheduledPublication?.state === 'needs_reconfirm'
              ? handleConfirmScheduledPublication
              : undefined
          }
          onCancelScheduledPublication={
            scheduledPublication != null ? handleCancelScheduledPublication : undefined
          }
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onCopyToLocale={handleCopyToLocale}
          onDeleteLocale={handleDeleteLocale}
          contentLocales={contentLocales}
          publishedVersion={publishedVersion}
          restoreWarnings={restoreWarnings}
          nextStatus={nextStatus}
          workflowStatuses={workflowStatuses}
          onCancel={() => {
            // Close consumes the return target — clear the stored fallback so
            // re-opening this document later degrades to the bare list unless
            // a fresh `from` is supplied.
            clearListReturnState(path, String(initialData.id))
            navigate({
              to: getAdminRoutePath('collections', '$collection'),
              params: { collection: path },
              search: returnSearch,
            })
          }}
          collectionPath={path}
        />
      </Container>
    </Section>
  )
}
