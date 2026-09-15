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
import { Alert, Button, ComboButton, LoaderEllipsis } from '@byline/ui/react'
import cx from 'clsx'

import { useBylineFieldServices } from '../fields/field-services-context'
import { AvailableLocalesWidget } from './available-locales-widget'
import { DocumentActions, type DocumentActionsLocaleOption } from './document-actions'
import { FormProvider, useFieldValue, useFormContext } from './form-context'
import { FormLayout } from './form-layout'
import { NavigationGuardModal, SystemFieldsConfirmModal, UnsavedChangesModal } from './form-modals'
import { FormHeadingRow } from './form-page-chrome'
import styles from './form-renderer.module.css'
import { FormStatusDisplay } from './form-status-display'
import { useNavigationGuardAdapter } from './navigation-guard'
import { PathWidget } from './path-widget'
import {
  ScheduledPublicationCell,
  type ScheduledPublicationInfo,
  ScheduledPublicationNotice,
  type SchedulePublicationInput,
  useScheduledPublication,
} from './scheduled-publication-control'
import { computeStatusTransitions } from './status-transitions'
import { TreePlacementWidget } from './tree-placement-widget'
import { useFormSubmission } from './use-form-submission'
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
  onSubmit: (data: any) => void | Promise<void>
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
  const formRef = useRef<HTMLFormElement>(null)
  const focusBeforeBusyRef = useRef<HTMLElement | null>(null)
  const restoreFocusAfterBusyRef = useRef(false)
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
  const [discarding, setDiscarding] = useState(false)
  const [reloadFailed, setReloadFailed] = useState(false)
  const warningRef = useRef<HTMLDivElement>(null)
  const mutationBlockedRef = useRef(mutationsBlocked)
  mutationBlockedRef.current = mutationsBlocked || discarding
  const guard = useGuard(hasChanges && !discarding)
  useEffect(() => {
    if (mutationIssue) warningRef.current?.focus()
  }, [mutationIssue])
  useEffect(() => {
    if (!discarding) return
    // Let the guard's beforeunload listener detach before the explicit discard.
    Promise.resolve()
      .then(() => (onReloadDocument ? onReloadDocument() : window.location.reload()))
      .catch(() => {
        setDiscarding(false)
        setReloadFailed(true)
      })
  }, [discarding, onReloadDocument])

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

  const captureFocusBeforeBusy = useCallback(() => {
    if (focusBeforeBusyRef.current != null) return
    const activeElement = document.activeElement
    if (!(activeElement instanceof HTMLElement) || !formRef.current?.contains(activeElement)) return
    focusBeforeBusyRef.current = activeElement
    restoreFocusAfterBusyRef.current = true
  }, [])

  // One save at a time: validate -> upload -> (confirm) -> submit. Admission is
  // decided synchronously inside the hook, so two Saves in the same turn cannot
  // both get through. `phase` is what the UI renders.
  const submission = useFormSubmission({
    mode,
    fields,
    documentId: mode === 'edit' && typeof initialData?.id === 'string' ? initialData.id : undefined,
    advertiseLocales,
    onSubmit,
    isBlocked: () => mutationBlockedRef.current,
    onBeforeBusy: captureFocusBeforeBusy,
  })
  const isUploading = submission.phase.kind === 'uploading'
  const isSubmitting = submission.phase.kind === 'submitting'
  const isBusy = submission.isBusy
  const pendingSystemFieldsSubmit =
    submission.phase.kind === 'confirmingSystemFields' ? submission.phase.payload : null

  // `inert` removes the active control from the tab order while a save is in
  // flight. Restore the editor's position after React has removed `inert`;
  // when the original control became disabled, fall back to the first usable
  // form control instead of leaving focus on <body>.
  useEffect(() => {
    if (isBusy || !restoreFocusAfterBusyRef.current) return
    restoreFocusAfterBusyRef.current = false

    if (mutationIssue) {
      warningRef.current?.focus()
      focusBeforeBusyRef.current = null
      return
    }
    const original = focusBeforeBusyRef.current
    focusBeforeBusyRef.current = null
    const originalCanReceiveFocus =
      original?.isConnected === true && !original.matches(':disabled, [aria-disabled="true"]')
    const target = originalCanReceiveFocus
      ? original
      : formRef.current?.querySelector<HTMLElement>(
          'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
    target?.focus({ preventScroll: true })
  }, [isBusy, mutationIssue])

  const handleCancel = () => {
    if (onCancel && typeof onCancel === 'function') {
      onCancel()
    }
  }

  const handleSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
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
          <div className={cx('byline-form-status-bar', styles['status-bar'])}>
            <div className={cx('byline-form-status-details', styles['status-details'])}>
              <FormStatusDisplay
                disabled={mutationsBlocked || discarding}
                initialData={initialData}
                workflowStatuses={workflowStatuses}
                publishedVersion={publishedVersion}
                onUnpublish={onUnpublish}
                afterStatusCells={
                  <ScheduledPublicationCell
                    state={scheduling.state}
                    timeZone={scheduling.timeZone}
                  />
                }
              />
            </div>
            <div className={cx('byline-form-actions', styles.actions)}>
              <Button
                className={cx('byline-form-actions-button', styles['actions-button'])}
                size="sm"
                intent="noeffect"
                type="button"
                onClick={handleCancel}
              >
                {hasChanges === false ? t('common.actions.close') : t('common.actions.cancel')}
              </Button>
              <Button
                className={cx('byline-form-actions-button', styles['actions-button'])}
                size="sm"
                type="submit"
                disabled={
                  mutationsBlocked ||
                  discarding ||
                  hasChanges === false ||
                  isUploading ||
                  isSubmitting
                }
                aria-label={isSubmitting ? t('common.actions.save') : undefined}
              >
                {isUploading ? (
                  t('forms.actions.uploading')
                ) : (
                  <span className={cx('byline-form-save-content', styles['save-content'])}>
                    <span
                      className={cx(
                        'byline-form-save-label',
                        styles['save-label'],
                        isSubmitting && styles['save-label-hidden']
                      )}
                    >
                      {t('common.actions.save')}
                    </span>
                    {isSubmitting ? (
                      <span className={cx('byline-form-save-loader', styles['save-loader'])}>
                        <LoaderEllipsis size={28} aria-hidden="true" />
                      </span>
                    ) : null}
                  </span>
                )}
              </Button>
              {primaryStatus && onStatusChange && (
                <div
                  className={cx('byline-form-actions-status-wrap', styles['actions-status-wrap'])}
                >
                  <ComboButton
                    buttonClassName={cx(
                      'byline-form-actions-combo-button',
                      styles['actions-combo-button']
                    )}
                    triggerClassName={cx(
                      'byline-form-actions-combo-trigger',
                      styles['actions-combo-trigger']
                    )}
                    options={secondaryStatuses.map((s) => ({
                      label: isTerminal
                        ? t('forms.actions.revertTo', { label: s.label ?? s.name })
                        : (s.verb ?? s.label ?? s.name),
                      value: s.name,
                    }))}
                    sideOffset={5}
                    size="sm"
                    type="button"
                    intent={isTerminal ? 'info' : 'success'}
                    disabled={mutationsBlocked || discarding || statusBusy}
                    onOptionSelect={async (value: string) => {
                      if (mutationBlockedRef.current) return
                      if (hasChanges) {
                        setShowUnsavedModal(true)
                        return
                      }
                      setStatusBusy(true)
                      try {
                        await onStatusChange(value)
                      } catch (error) {
                        onMutationError?.(error)
                      } finally {
                        setStatusBusy(false)
                      }
                    }}
                    onButtonClick={
                      isTerminal
                        ? undefined
                        : async () => {
                            if (mutationBlockedRef.current) return
                            if (hasChanges) {
                              setShowUnsavedModal(true)
                              return
                            }
                            setStatusBusy(true)
                            try {
                              await onStatusChange(primaryStatus.name)
                            } catch (error) {
                              onMutationError?.(error)
                            } finally {
                              setStatusBusy(false)
                            }
                          }
                    }
                  >
                    {statusBusy
                      ? '...'
                      : isTerminal
                        ? (primaryStatus.label ?? primaryStatus.name)
                        : (primaryStatus.verb ?? primaryStatus.label ?? primaryStatus.name)}
                  </ComboButton>
                </div>
              )}
              <DocumentActions
                disabled={mutationsBlocked || discarding}
                publishedVersion={publishedVersion}
                onUnpublish={onUnpublish}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                sourceTitle={
                  useAsTitle != null && initialData != null
                    ? ((initialData as Record<string, unknown>)[useAsTitle] as
                        | string
                        | null
                        | undefined)
                    : null
                }
                onCopyToLocale={onCopyToLocale}
                sourceLocale={contentLocale}
                contentLocales={contentLocales}
                hasUnsavedChanges={hasChanges}
                onUnsavedChanges={() => setShowUnsavedModal(true)}
                onDeleteLocale={onDeleteLocale}
                defaultLocale={defaultLocale}
                availableLocales={initialData?._availableVersionLocales as string[] | undefined}
                scheduledPublicationState={scheduling.state}
                onSchedulePublication={scheduling.openSchedule}
                onConfirmScheduledPublication={scheduling.confirm}
                onCancelScheduledPublication={scheduling.cancel}
              />
            </div>
          </div>
          {(mutationIssue || scheduledPublicationsNeedReconfirmation) && (
            <div
              ref={warningRef}
              tabIndex={-1}
              role="alert"
              aria-live="assertive"
              className={cx('byline-document-concurrency', styles.concurrency)}
            >
              {mutationIssue && (
                <Alert
                  intent="warning"
                  icon
                  close={false}
                  title={t(`documentConcurrency.${mutationIssue}Title`)}
                >
                  <p>{t(`documentConcurrency.${mutationIssue}`)}</p>
                  {mutationIssue !== 'committed' && (
                    <Button
                      type="button"
                      disabled={discarding}
                      onClick={() => {
                        setReloadFailed(false)
                        setDiscarding(true)
                      }}
                    >
                      {t('documentConcurrency.reloadAction')}
                    </Button>
                  )}
                  {reloadFailed && <p>{t('documentConcurrency.reloadFailed')}</p>}
                </Alert>
              )}
              {scheduledPublicationsNeedReconfirmation && (
                <Alert
                  intent="warning"
                  icon
                  close={false}
                  title={t('documentConcurrency.schedulesTitle')}
                >
                  <p>{t('documentConcurrency.schedules')}</p>
                  {scheduledPublicationsHref && (
                    <a href={scheduledPublicationsHref}>
                      {t('documentConcurrency.reviewSchedules')}
                    </a>
                  )}
                </Alert>
              )}
            </div>
          )}
          <ScheduledPublicationNotice
            state={scheduling.state}
            timeZone={scheduling.timeZone}
            busy={mutationsBlocked || discarding || scheduling.busy}
            onConfirm={scheduling.confirm}
            onReschedule={scheduling.openSchedule}
            onCancel={scheduling.cancel}
          />
          {scheduling.modal}
          {restoreWarnings && restoreWarnings.length > 0 && (
            <Alert
              className="m-0 mt-4"
              intent="warning"
              icon={true}
              close={false}
              title={t('forms.restoreWarnings.title')}
            >
              <p>{t('forms.restoreWarnings.body', { count: restoreWarnings.length })}</p>
              <ul>
                {restoreWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
          <FormLayout
            fields={fields}
            adminConfig={adminConfig}
            initialData={initialData}
            activeLocale={contentLocale}
            collectionPath={collectionPath ?? undefined}
            activeTabBySet={activeTabBySet}
            onTabChange={handleTabChange}
            sidebarSlot={
              <>
                {/* A locked collection's widget renders even with no `useAsPath`
                    and nothing stored yet: its path is managed, and the editor
                    needs to see that. `showPath: false` still wins — it marks a
                    path that must never be presented at all. */}
                {showPath &&
                  (useAsPath ||
                    adminConfig?.lockPath === true ||
                    (typeof initialData?.path === 'string' && initialData.path.length > 0)) && (
                    <PathWidget
                      disabled={mutationsBlocked || discarding}
                      useAsPath={useAsPath}
                      collectionPath={collectionPath ?? ''}
                      defaultLocale={defaultLocale}
                      activeLocale={contentLocale}
                      mode={mode}
                      slugifier={pathSlugifier}
                      sourceLocked={pathSourceLocked}
                      lockPath={adminConfig?.lockPath}
                    />
                  )}
                {tree && mode === 'edit' && typeof initialData?.id === 'string' && (
                  <TreePlacementWidget
                    disabled={mutationsBlocked || discarding}
                    onMutationError={onMutationError}
                    onCommitted={onTreeMutationCommitted}
                    expectedRevision={observedRevision ?? initialData.revision}
                    collectionPath={collectionPath ?? ''}
                    documentId={initialData.id as string}
                    useAsTitle={useAsTitle}
                  />
                )}
                {advertiseLocales && (
                  <AvailableLocalesWidget
                    disabled={mutationsBlocked || discarding}
                    contentLocales={contentLocales ?? []}
                    availableVersionLocales={
                      (initialData?._availableVersionLocales as string[] | undefined) ?? []
                    }
                  />
                )}
              </>
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
