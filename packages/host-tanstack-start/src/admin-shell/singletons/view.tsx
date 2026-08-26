'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useRouter } from '@tanstack/react-router'

import { FormRenderer } from '@byline/admin/react'
import type { SingletonAdminConfig, SingletonDefinition } from '@byline/core'
import {
  ErrorCodes,
  getDefaultStatus,
  getWorkflow,
  getWorkflowStatuses,
  validateStatusTransition,
} from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Container, Section, useToastManager } from '@byline/ui/react'

import { getAdminRoutePath } from '../../routes/admin-path.js'
import {
  cancelSingletonScheduledPublish,
  changeSingletonStatus,
  confirmSingletonScheduledPublish,
  copySingletonToLocale,
  scheduleSingletonPublish,
  unpublishSingleton,
  updateSingleton,
} from '../../server-fns/singletons/index.js'
import { useNavigate } from '../chrome/loose-router.js'
import { useTanStackNavigationGuard } from '../collections/tanstack-navigation-guard.js'
import { SingletonViewMenu } from './view-menu.js'
import type { SerializedDocumentPublishSchedule } from '../../server-fns/collections/index.js'
import type { ContentLocaleOption } from '../collections/view-menu.js'

type SingletonDocument = Record<string, any> & {
  id: string
  status: string
  fields: Record<string, any>
}

function errorCode(error: unknown): string | null {
  return typeof (error as { code?: unknown })?.code === 'string'
    ? (error as { code: string }).code
    : null
}

export function SingletonView({
  singletonDefinition,
  adminConfig,
  document,
  initialData,
  locale,
  contentLocales,
  defaultContentLocale,
}: {
  singletonDefinition: SingletonDefinition
  adminConfig?: SingletonAdminConfig
  document: SingletonDocument | null
  /** Schema defaults resolved by the server-side route loader for an empty slot. */
  initialData?: Record<string, any>
  locale?: string
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
}) {
  const router = useRouter()
  const navigate = useNavigate()
  const toastManager = useToastManager()
  const { t } = useTranslation('byline-admin')
  const { path, label, fields } = singletonDefinition

  const workflowStatuses = getWorkflowStatuses(singletonDefinition)
  const currentStatus = document?.status ?? getDefaultStatus(singletonDefinition)
  const currentIndex = workflowStatuses.findIndex((status) => status.name === currentStatus)
  const nextStatus =
    currentIndex !== -1 && currentIndex < workflowStatuses.length - 1
      ? workflowStatuses[currentIndex + 1]
      : undefined
  const publishedVersion = document?._publishedVersion ?? null
  const restoreWarnings = document?._restoreWarnings as string[] | undefined
  const scheduledPublicationEnabled = document?._scheduledPublicationEnabled === true
  const canSchedulePublication = document?._canSchedulePublication === true
  const scheduledPublication = (document?._scheduledPublish ??
    null) as SerializedDocumentPublishSchedule | null
  const publishTransitionValid =
    document != null &&
    currentStatus !== 'published' &&
    workflowStatuses.length > 1 &&
    validateStatusTransition(getWorkflow(singletonDefinition), currentStatus, 'published').valid
  const canArmSchedule =
    scheduledPublicationEnabled && canSchedulePublication && publishTransitionValid

  const reload = async () => {
    // Invalidation is load-bearing after the first save: the refreshed loader
    // supplies the mapped document id/version, flips FormRenderer to edit mode,
    // and unlocks fields that require a saved document.
    await router.invalidate()
  }

  const toast = (title: string, description: string, intent: 'success' | 'warning' | 'danger') => {
    toastManager.add({
      title,
      description,
      data: { intent, iconType: intent, icon: true, close: true },
    })
  }

  const notifyScheduleSuspended = () => {
    if (scheduledPublication?.state !== 'armed') return
    toast(
      t('scheduledPublication.toast.suspendedTitle'),
      t('scheduledPublication.toast.suspendedDescription'),
      'warning'
    )
  }

  const handleSubmit = async ({ data }: { data: Record<string, any> }) => {
    try {
      await updateSingleton({
        data: {
          singleton: path,
          data,
          locale: locale ?? defaultContentLocale,
          expectedVersionId: document?.versionId,
        },
      })
      if (document != null) notifyScheduleSuspended()
      toast(
        t('singletons.edit.updateTitle', { label }),
        t('singletons.edit.updatedDescription', { label: label.toLowerCase() }),
        'success'
      )
      await reload()
    } catch (err) {
      const code = errorCode(err)
      const description =
        code === ErrorCodes.CONFLICT
          ? t('singletons.edit.conflictDescription')
          : code === ErrorCodes.NOT_FOUND
            ? t('singletons.edit.notConfiguredDescription')
            : t('singletons.edit.updateFailedDescription', { label: label.toLowerCase() })
      toast(t('singletons.edit.updateTitle', { label }), description, 'danger')

      // FormRenderer commits its clean baseline only when this promise
      // resolves. Rethrow so a failed singleton save leaves the editor dirty
      // and its navigation guard active.
      throw err
    }
  }

  const handleStatusChange = async (status: string) => {
    try {
      await changeSingletonStatus({ data: { singleton: path, status } })
      toast(
        t('collections.edit.statusUpdateTitle', { label }),
        t('collections.edit.statusChangedDescription', { status }),
        'success'
      )
      await reload()
    } catch (err) {
      toast(
        t('collections.edit.statusUpdateTitle', { label }),
        t('collections.edit.statusChangeFailedDescription', { message: (err as Error).message }),
        'danger'
      )
      throw err
    }
  }

  const handleUnpublish = async () => {
    try {
      await unpublishSingleton({ data: { singleton: path } })
      toast(
        t('collections.edit.unpublishTitle', { label }),
        t('collections.edit.unpublishedDescription'),
        'success'
      )
      await reload()
    } catch (err) {
      toast(
        t('collections.edit.unpublishTitle', { label }),
        t('collections.edit.unpublishFailedDescription', { message: (err as Error).message }),
        'danger'
      )
      throw err
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
      await copySingletonToLocale({
        data: {
          singleton: path,
          sourceLocale: locale ?? defaultContentLocale,
          targetLocale,
          overwrite,
        },
      })
      const sourceLocale = locale ?? defaultContentLocale
      const sourceLabel =
        contentLocales.find((entry) => entry.code === sourceLocale)?.label ?? sourceLocale
      const targetLabel =
        contentLocales.find((entry) => entry.code === targetLocale)?.label ?? targetLocale
      toast(
        t('collections.edit.copyToLocaleTitle', { label }),
        t('collections.edit.copiedSuccessMessage', {
          source: sourceLabel,
          target: targetLabel,
        }),
        'success'
      )
      notifyScheduleSuspended()
      navigate({
        to: getAdminRoutePath('singletons', '$singleton'),
        params: { singleton: path },
        search: { locale: targetLocale },
      })
    } catch (err) {
      toast(
        t('collections.edit.copyToLocaleTitle', { label }),
        t('collections.edit.copyFailedDescription', { message: (err as Error).message }),
        'danger'
      )
      throw err
    }
  }

  const handleSchedulePublication = async ({ publishAt }: { publishAt: string }) => {
    try {
      await scheduleSingletonPublish({
        data: { singleton: path, publishAt, expectedVersionId: String(document?.versionId) },
      })
      toast(
        t('scheduledPublication.toast.scheduledTitle'),
        t('scheduledPublication.toast.scheduledDescription'),
        'success'
      )
      await reload()
    } catch (err) {
      toast(t('scheduledPublication.toast.failedTitle'), (err as Error).message, 'danger')
      throw err
    }
  }

  const handleConfirmScheduledPublication = async () => {
    try {
      await confirmSingletonScheduledPublish({
        data: { singleton: path, expectedVersionId: String(document?.versionId) },
      })
      toast(
        t('scheduledPublication.toast.confirmedTitle'),
        t('scheduledPublication.toast.confirmedDescription'),
        'success'
      )
      await reload()
    } catch (err) {
      toast(t('scheduledPublication.toast.failedTitle'), (err as Error).message, 'danger')
      throw err
    }
  }

  const handleCancelScheduledPublication = async () => {
    try {
      await cancelSingletonScheduledPublish({ data: { singleton: path } })
      toast(
        t('scheduledPublication.toast.cancelledTitle'),
        t('scheduledPublication.toast.cancelledDescription'),
        'success'
      )
      await reload()
    } catch (err) {
      toast(t('scheduledPublication.toast.failedTitle'), (err as Error).message, 'danger')
      throw err
    }
  }

  return (
    <Section>
      <Container>
        <FormRenderer
          mode={document == null ? 'create' : 'edit'}
          fields={fields}
          onSubmit={handleSubmit}
          initialData={document ?? (initialData ? { fields: initialData } : undefined)}
          adminConfig={adminConfig}
          heading={label}
          showPath={false}
          initialLocale={locale}
          defaultLocale={defaultContentLocale}
          onLocaleChange={
            document == null
              ? undefined
              : (nextLocale) =>
                  navigate({
                    to: getAdminRoutePath('singletons', '$singleton'),
                    params: { singleton: path },
                    search: { locale: nextLocale },
                  })
          }
          useNavigationGuard={useTanStackNavigationGuard}
          headerSlot={
            document == null ? undefined : (
              <SingletonViewMenu
                singleton={path}
                activeView="edit"
                locale={locale}
                contentLocales={contentLocales}
                defaultContentLocale={defaultContentLocale}
                adminConfig={adminConfig}
                doc={document}
              />
            )
          }
          onStatusChange={document == null ? undefined : handleStatusChange}
          onUnpublish={document != null && publishedVersion ? handleUnpublish : undefined}
          scheduledPublication={document == null ? null : scheduledPublication}
          onSchedulePublication={canArmSchedule ? handleSchedulePublication : undefined}
          onConfirmScheduledPublication={
            canArmSchedule && scheduledPublication?.state === 'needs_reconfirm'
              ? handleConfirmScheduledPublication
              : undefined
          }
          onCancelScheduledPublication={
            document != null && scheduledPublication != null
              ? handleCancelScheduledPublication
              : undefined
          }
          onCopyToLocale={document == null ? undefined : handleCopyToLocale}
          contentLocales={document == null ? undefined : contentLocales}
          publishedVersion={document == null ? null : publishedVersion}
          restoreWarnings={restoreWarnings}
          nextStatus={document == null ? undefined : nextStatus}
          workflowStatuses={document == null ? undefined : workflowStatuses}
          onCancel={() => navigate({ to: getAdminRoutePath() })}
          collectionPath={path}
        />
      </Container>
    </Section>
  )
}
