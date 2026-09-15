'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AdminResourceConfig, Field, WorkflowStatus } from '@byline/core'
import { getAdminConfig } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import cx from 'clsx'

import { useBylineFieldServices } from '../fields/field-services-context'
import { FormProvider, useFieldValue, useFormContext } from './form-context'
import { FormLayout } from './form-layout'
import { NavigationGuardModal, SystemFieldsConfirmModal, UnsavedChangesModal } from './form-modals'
import {
  FormConcurrencyNotices,
  FormHeadingRow,
  FormSidebarWidgets,
  FormStatusBar,
} from './form-page-chrome'
import styles from './form-renderer.module.css'
import { useNavigationGuardAdapter } from './navigation-guard'
import {
  type ScheduledPublicationInfo,
  type SchedulePublicationInput,
  useScheduledPublication,
} from './scheduled-publication-control'
import { computeStatusTransitions } from './status-transitions'
import { useDocumentReloadRecovery } from './use-document-reload-recovery'
import { type SystemFieldsSubmitPayload, useFormSubmission } from './use-form-submission'
import type { DocumentActionsLocaleOption } from './document-actions'
import type { UseNavigationGuard } from './navigation-guard'

// Re-exported so existing importers of this module keep working; the type now
// lives with `useFormSubmission`, which produces it.
export type { SystemFieldsSubmitPayload } from './use-form-submission'

/** Metadata about a previously published version that is still live. */
export interface PublishedVersionInfo {
  id: string
  versionId: string
  status: string
  createdAt: string | Date
  updatedAt: string | Date
}

/** Props shared by both the public FormRenderer and its internal FormContent component. */
export interface FormRendererProps {
  mutationIssue?: 'stale' | 'reload' | 'lock' | 'unavailable' | 'committed' | null
  mutationsBlocked?: boolean
  observedRevision?: number
  onMutationError?: (error: unknown) => 'blocked' | 'committed' | null | void
  onTreeMutationCommitted?: (receipt: import('@byline/core').StructuralMutationReceipt) => void
  scheduledPublicationsNeedReconfirmation?: boolean
  scheduledPublicationsHref?: string
  /** Explicit discard action; defaults to a complete server reload. */
  onReloadDocument?: () => void | Promise<void>
  mode: 'create' | 'edit'
  fields: Field[]
  onSubmit: (data: SystemFieldsSubmitPayload) => void | Promise<void>
  onCancel: () => void
  onStatusChange?: (nextStatus: string) => Promise<void>
  onUnpublish?: () => Promise<void>
  scheduledPublication?: ScheduledPublicationInfo | null
  onSchedulePublication?: (input: SchedulePublicationInput) => Promise<void>
  onConfirmScheduledPublication?: () => Promise<void>
  onCancelScheduledPublication?: () => Promise<void>
  onDelete?: () => Promise<void>
  /**
   * Called when the editor confirms the duplicate modal in
   * `DocumentActions`. Edit views provide a handler that invokes the
   * `duplicateCollectionDocument` server fn and navigates to the new doc.
   * When omitted, the Duplicate menu item is hidden.
   */
  onDuplicate?: () => Promise<void>
  /**
   * Called when the editor confirms the Copy-to-Locale modal in
   * `DocumentActions`. Edit views provide a handler that invokes the
   * `copyDocumentToLocale` server fn and navigates to the target-locale
   * view. When omitted (or when fewer than two `contentLocales` are
   * configured), the Copy-to-Locale menu item is hidden.
   */
  onCopyToLocale?: (args: { targetLocale: string; overwrite: boolean }) => Promise<void>
  /**
   * Called when the editor confirms the Delete-Locale modal in
   * `DocumentActions`. Edit views provide a handler that invokes the
   * `deleteDocumentLocale` server fn and navigates to a surviving locale.
   * When omitted (or when the document has no non-default locale with
   * content), the Delete-Locale menu item is hidden.
   */
  onDeleteLocale?: (args: { targetLocale: string }) => Promise<void>
  /**
   * All configured content locales (code + display label) — required for
   * the Copy-to-Locale modal's target Select. Threaded as an opaque list
   * through to `DocumentActions`.
   */
  contentLocales?: ReadonlyArray<DocumentActionsLocaleOption>
  nextStatus?: WorkflowStatus
  workflowStatuses?: WorkflowStatus[]
  publishedVersion?: PublishedVersionInfo | null
  initialData?: Record<string, any>
  /**
   * Presentation configuration for the resource being edited — a collection
   * or a singleton. Typed as the union rather than the shared
   * `FormAdminConfig` base so the renderer can read collection-only members
   * such as `lockPath`.
   */
  adminConfig?: AdminResourceConfig
  /**
   * Name of the schema field to render as the live form heading.
   * Sourced from `CollectionDefinition.useAsTitle` by the caller.
   */
  useAsTitle?: string
  /**
   * Name of the schema field that initialises the system path.
   * Sourced from `CollectionDefinition.useAsPath` by the caller. When
   * present the path widget renders in the sidebar.
   */
  useAsPath?: string
  /**
   * Whether the system path widget may render in the sidebar. Defaults to
   * `true`, which preserves the historical behaviour of showing the widget
   * whenever `useAsPath` is declared or the document envelope carries a
   * `path`. Set `false` for a resource whose path is internal metadata and
   * must never be presented or edited.
   */
  showPath?: boolean
  /**
   * Explicit form heading, used verbatim. Overrides both `useAsTitle`'s live
   * value and the create/edit wording derived from `mode` — for a resource
   * whose identity does not change when it is first materialised.
   */
  heading?: string
  /**
   * Opts the available-locales widget into the sidebar (below the path
   * widget). Sourced from `CollectionDefinition.advertiseLocales` by the
   * caller. When true, one checkbox per content locale renders, reconciled
   * against the document's `_availableVersionLocales` ledger fact.
   */
  advertiseLocales?: boolean
  /**
   * Opts the document-tree placement widget into the sidebar (above the
   * available-locales widget). Sourced from `CollectionDefinition.tree` by the
   * caller. Renders only in edit mode (placement needs a persisted document)
   * and only when the host wires the tree services. See docs/04-collections/04-document-trees.md.
   */
  tree?: boolean
  headingLabel?: string
  headerSlot?: ReactNode
  /** Collection path forwarded to upload-capable fields (e.g. `'media'`). */
  collectionPath?: string
  /** The active content locale — initialised from the route query string. */
  initialLocale?: string
  /** Called when the user picks a different content locale. */
  onLocaleChange?: (locale: string) => void
  /**
   * Schema-mismatch warnings produced by a "best-effort" reconstruction
   * of the document (`findById({ lenient: true })`). When present, the
   * form renders an inline Alert telling the editor that fields from a
   * previous schema have been dropped — saving the form will overwrite
   * them with the new shape.
   */
  restoreWarnings?: string[]
  /**
   * Default content locale used when no `initialLocale` is supplied and as the
   * fallback inside `PathWidget`. Hosts typically pass their app-wide
   * `i18n.content.defaultLocale`. Defaults to `'en'`.
   */
  defaultLocale?: string
  /**
   * Framework-specific navigation guard hook.
   * When provided, this overrides the adapter from `NavigationGuardProvider` context.
   * If neither is set, a no-op `beforeunload`-only guard is used.
   */
  useNavigationGuard?: UseNavigationGuard
}

const FormContent = ({
  mode,
  mutationIssue,
  mutationsBlocked = false,
  observedRevision,
  onMutationError,
  onTreeMutationCommitted,
  scheduledPublicationsNeedReconfirmation = false,
  scheduledPublicationsHref,
  onReloadDocument,
  fields,
  onSubmit,
  onCancel,
  onStatusChange,
  onUnpublish,
  scheduledPublication,
  onSchedulePublication,
  onConfirmScheduledPublication,
  onCancelScheduledPublication,
  onDelete,
  onDuplicate,
  onCopyToLocale,
  onDeleteLocale,
  contentLocales,
  nextStatus,
  workflowStatuses,
  publishedVersion,
  initialData,
  adminConfig,
  useAsTitle,
  useAsPath,
  showPath = true,
  heading,
  advertiseLocales,
  tree,
  headingLabel,
  headerSlot,
  collectionPath,
  initialLocale,
  onLocaleChange,
  defaultLocale = 'en',
  useNavigationGuard: useNavigationGuardProp,
  restoreWarnings,
  _activeTabBySet,
  _onTabChange,
}: FormRendererProps & {
  /** Lifted active-tab-per-set map from FormRenderer — preserves tab choices across locale-change remounts. */
  _activeTabBySet?: Record<string, string>
  _onTabChange?: (tabSetName: string, tabName: string) => void
}) => {
  // Field state now reaches the submission hook and the layout walk directly;
  // FormContent keeps only what its own chrome needs.
  const { hasChanges: hasChangesFn, subscribeMeta } = useFormContext()
  const { t } = useTranslation('byline-admin')

  const [hasChanges, setHasChanges] = useState(hasChangesFn())
  const [statusBusy, setStatusBusy] = useState(false)
  // Block-only "save first" guard. Set true when the editor triggers a
  // guarded action (status change, duplicate, copy-to-locale) while the form
  // is dirty — those actions operate on the saved version, so unsaved edits
  // would be silently excluded.
  const [showUnsavedModal, setShowUnsavedModal] = useState(false)
  const [contentLocale, setContentLocale] = useState(initialLocale ?? defaultLocale)

  // Scheduled publication owns three placements — a status-bar cell, an
  // escalated notice, and the schedule modal — so its state lives here and the
  // surfaces are rendered where each belongs.
  const scheduling = useScheduledPublication({
    disabled: mutationsBlocked,
    schedule: scheduledPublication ?? null,
    onSchedule: onSchedulePublication,
    onConfirm: onConfirmScheduledPublication,
    onCancel: onCancelScheduledPublication,
    hasUnsavedChanges: hasChanges,
    onUnsavedChanges: () => setShowUnsavedModal(true),
  })
  const { uploadField } = useBylineFieldServices()

  // Path-widget wiring. The live preview must use the installation's
  // client-side slugifier (same function as `ServerConfig.slugifier`) so it
  // agrees with the persisted path. And when the `useAsPath` source is a
  // server-assigned `counter` or a read-only field, its value can't be
  // reproduced or changed through the form, so the widget suppresses its
  // source-derived preview and "Regenerate" affordance.
  const pathSlugifier = getAdminConfig().slugifier
  const pathSourceLocked = useMemo(() => {
    if (!useAsPath) return false
    const source = fields.find((f) => f.name === useAsPath)
    return source != null && (source.type === 'counter' || source.readOnly === true)
  }, [useAsPath, fields])

  // Sync contentLocale when the route re-fetches with a different locale.
  useEffect(() => {
    if (initialLocale) setContentLocale(initialLocale)
  }, [initialLocale])

  // ---------------------------------------------------------------------
  // Active-tab state — one tab name per declared tab set.
  // Lifted into FormRenderer via `_activeTabBySet` / `_onTabChange` so the
  // user's tab choices survive the locale-change remount triggered by
  // FormProvider's `key` prop.
  // ---------------------------------------------------------------------

  const tabSets = adminConfig?.tabSets ?? []

  const initialActiveTabBySet = useMemo<Record<string, string>>(() => {
    const result: Record<string, string> = {}
    for (const set of tabSets) {
      const saved = _activeTabBySet?.[set.name]
      if (saved && set.tabs.some((t) => t.name === saved)) {
        result[set.name] = saved
      } else {
        result[set.name] = set.tabs[0]?.name ?? ''
      }
    }
    return result
    // initial-only; subsequent updates flow through setActiveTabBySet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabSets, _activeTabBySet])

  const [activeTabBySet, setActiveTabBySet] =
    useState<Record<string, string>>(initialActiveTabBySet)

  const handleTabChange = useCallback(
    (tabSetName: string, tabName: string) => {
      setActiveTabBySet((prev) => ({ ...prev, [tabSetName]: tabName }))
      _onTabChange?.(tabSetName, tabName)
    },
    [_onTabChange]
  )

  // Live document heading — tracks the useAsTitle field as the user types
  const liveTitle = useFieldValue<string>(useAsTitle ?? '')
  const computedHeading =
    heading ||
    liveTitle ||
    (headingLabel
      ? mode === 'create'
        ? t('forms.heading.createLabel', { label: headingLabel })
        : t('forms.heading.editLabel', { label: headingLabel })
      : mode === 'create'
        ? t('forms.heading.create')
        : t('forms.heading.edit'))

  // Navigation guard — block router navigation and browser unload when dirty.
  // The guard hook is injected by the consuming framework (prop > context > no-op fallback).
  const guardFromContext = useNavigationGuardAdapter()
  const useGuard = useNavigationGuardProp ?? guardFromContext
  // Compute available status transitions
  const currentStatus = initialData?.status
  const { primaryStatus, secondaryStatuses, isTerminal } = computeStatusTransitions(
    currentStatus,
    workflowStatuses,
    nextStatus
  )

  useEffect(() => {
    return subscribeMeta(() => setHasChanges(hasChangesFn()))
  }, [subscribeMeta, hasChangesFn])

  // One save at a time: validate -> upload -> (confirm) -> submit. Admission is
  // decided synchronously inside the hook, so two Saves in the same turn cannot
  // both get through. `phase` is what the UI renders.
  const submission = useFormSubmission({
    mode,
    fields,
    documentId: mode === 'edit' && typeof initialData?.id === 'string' ? initialData.id : undefined,
    advertiseLocales,
    onSubmit,
    isBlocked: (): boolean => recovery.mutationBlockedRef.current,
    onBeforeBusy: (): void => recovery.captureFocusBeforeBusy(),
  })
  const recovery = useDocumentReloadRecovery({
    mutationsBlocked,
    mutationIssue,
    onReloadDocument,
    isBusy: submission.isBusy,
  })
  const { formRef, warningRef, mutationBlockedRef, discarding, reloadFailed, requestDiscard } =
    recovery
  const guard = useGuard(hasChanges && !discarding)
  const isUploading = submission.phase.kind === 'uploading'
  const isSubmitting = submission.phase.kind === 'submitting'
  const isBusy = submission.isBusy
  const pendingSystemFieldsSubmit =
    submission.phase.kind === 'confirmingSystemFields' ? submission.phase.payload : null

  const handleCancel = () => {
    if (onCancel && typeof onCancel === 'function') {
      onCancel()
    }
  }

  const handleSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
    // A form rendered into a portal is not a DOM descendant of this one, so no
    // invalid nested-form markup arises — but React propagates synthetic events
    // along the *React* tree, so its submit still reaches this handler. Nothing
    // about `currentTarget` reveals that: it is always this form while the
    // handler runs, bubbled event or not. The event's origin is what
    // distinguishes them.
    //
    // Deliberately no `preventDefault()` on the way out: the submit belongs to
    // the inner form, and suppressing its default here would take that decision
    // away from the handler that owns it.
    if (e.target !== e.currentTarget) return
    e.preventDefault()
    if (mutationBlockedRef.current) return
    void submission.submit()
  }

  const busyAnnouncement = isUploading
    ? t('forms.actions.uploading')
    : isSubmitting
      ? t('forms.actions.saving')
      : ''

  return (
    <>
      <span
        className={cx('byline-form-busy-status', styles['busy-status'])}
        role="status"
        aria-live="polite"
      >
        {busyAnnouncement}
      </span>
      <div aria-busy={isBusy}>
        <form
          ref={formRef}
          method="post"
          noValidate
          onSubmit={handleSubmit}
          className={cx('byline-form', styles.form)}
          inert={isBusy ? true : undefined}
        >
          <FormHeadingRow heading={computedHeading} headerSlot={headerSlot} />
          <FormStatusBar
            disabled={mutationsBlocked || discarding}
            initialData={initialData}
            workflowStatuses={workflowStatuses}
            publishedVersion={publishedVersion}
            scheduling={scheduling}
            hasChanges={hasChanges}
            isUploading={isUploading}
            isSubmitting={isSubmitting}
            onCancel={handleCancel}
            transitions={{ primaryStatus, secondaryStatuses, isTerminal }}
            statusBusy={statusBusy}
            onStatusBusyChange={setStatusBusy}
            onStatusChange={onStatusChange}
            onMutationError={onMutationError}
            isBlocked={() => mutationBlockedRef.current}
            onUnsavedChanges={() => setShowUnsavedModal(true)}
            onUnpublish={onUnpublish}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onCopyToLocale={onCopyToLocale}
            onDeleteLocale={onDeleteLocale}
            useAsTitle={useAsTitle}
            contentLocale={contentLocale}
            contentLocales={contentLocales}
            defaultLocale={defaultLocale}
          />
          <FormConcurrencyNotices
            disabled={mutationsBlocked || discarding}
            mutationIssue={mutationIssue}
            scheduledPublicationsNeedReconfirmation={scheduledPublicationsNeedReconfirmation}
            scheduledPublicationsHref={scheduledPublicationsHref}
            warningRef={warningRef}
            discarding={discarding}
            reloadFailed={reloadFailed}
            onDiscardRequested={requestDiscard}
            scheduling={scheduling}
            restoreWarnings={restoreWarnings}
          />
          <FormLayout
            fields={fields}
            adminConfig={adminConfig}
            initialData={initialData}
            activeLocale={contentLocale}
            collectionPath={collectionPath ?? undefined}
            activeTabBySet={activeTabBySet}
            onTabChange={handleTabChange}
            sidebarSlot={
              <FormSidebarWidgets
                disabled={mutationsBlocked || discarding}
                mode={mode}
                initialData={initialData}
                collectionPath={collectionPath ?? ''}
                defaultLocale={defaultLocale}
                contentLocale={contentLocale}
                contentLocales={contentLocales}
                showPath={showPath}
                useAsPath={useAsPath}
                lockPath={adminConfig?.lockPath}
                pathSlugifier={pathSlugifier}
                pathSourceLocked={pathSourceLocked}
                tree={tree}
                useAsTitle={useAsTitle}
                advertiseLocales={advertiseLocales}
                observedRevision={observedRevision}
                onMutationError={onMutationError}
                onTreeMutationCommitted={onTreeMutationCommitted}
              />
            }
          />
          {showUnsavedModal && <UnsavedChangesModal onClose={() => setShowUnsavedModal(false)} />}
          {!mutationsBlocked && !discarding && pendingSystemFieldsSubmit != null && (
            <SystemFieldsConfirmModal
              contentDirty={pendingSystemFieldsSubmit.contentDirty}
              pathDirty={pendingSystemFieldsSubmit.pathDirty}
              availableLocalesDirty={pendingSystemFieldsSubmit.availableLocalesDirty}
              onCancel={submission.cancelSystemFields}
              onConfirm={() => {
                void submission.confirmSystemFields()
              }}
            />
          )}
          {guard.isBlocked && (
            <NavigationGuardModal onStay={guard.stay} onProceed={guard.proceed} />
          )}
        </form>
      </div>
    </>
  )
}

export const FormRenderer = (props: FormRendererProps) => {
  const { mode, initialData, initialLocale, collectionPath } = props

  // Persists per-tab-set active tab across locale-change remounts of FormContent.
  // useRef so mutations never trigger a re-render of FormRenderer itself.
  const savedTabsRef = useRef<Record<string, string>>({})

  return (
    <FormProvider
      key={`${initialLocale ?? 'default'}-${initialData?.versionId ?? ''}`}
      initialData={initialData}
      documentId={mode === 'edit' && typeof initialData?.id === 'string' ? initialData.id : null}
      collectionPath={collectionPath ?? null}
    >
      {/* Forwarded wholesale. An enumerated prop list here silently dropped
          every prop added to FormRendererProps but not copied down — which is
          how the scheduled-publication handlers reached FormContent as
          `undefined` and the control never rendered. */}
      <FormContent
        {...props}
        _activeTabBySet={savedTabsRef.current}
        _onTabChange={(tabSetName, tabName) => {
          savedTabsRef.current = { ...savedTabsRef.current, [tabSetName]: tabName }
        }}
      />
    </FormProvider>
  )
}
