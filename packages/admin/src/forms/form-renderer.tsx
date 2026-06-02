'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  CollectionAdminConfig,
  Field,
  GroupDefinition,
  RowDefinition,
  TabSetDefinition,
  WorkflowStatus,
} from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, ComboButton, Modal } from '@byline/ui/react'
import cx from 'classnames'

import { FieldRenderer } from '../fields/field-renderer'
import { useBylineFieldServices } from '../fields/field-services-context'
import { LocalDateTime } from '../fields/local-date-time'
import { AdminGroup } from '../presentation/group'
import { AdminRow } from '../presentation/row'
import { AdminTabs } from '../presentation/tabs'
import { AvailableLocalesWidget } from './available-locales-widget'
import { DocumentActions, type DocumentActionsLocaleOption } from './document-actions'
import { FormProvider, useFieldValue, useFormContext } from './form-context'
import styles from './form-renderer.module.css'
import { useNavigationGuardAdapter } from './navigation-guard'
import { PathWidget } from './path-widget'
import { executeUploadsWithProgress } from './upload-executor'
import type { UseNavigationGuard } from './navigation-guard'

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
  mode: 'create' | 'edit'
  fields: Field[]
  onSubmit: (data: any) => void
  onCancel: () => void
  onStatusChange?: (nextStatus: string) => Promise<void>
  onUnpublish?: () => Promise<void>
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
   * All configured content locales (code + display label) — required for
   * the Copy-to-Locale modal's target Select. Threaded as an opaque list
   * through to `DocumentActions`.
   */
  contentLocales?: ReadonlyArray<DocumentActionsLocaleOption>
  nextStatus?: WorkflowStatus
  workflowStatuses?: WorkflowStatus[]
  publishedVersion?: PublishedVersionInfo | null
  initialData?: Record<string, any>
  adminConfig?: CollectionAdminConfig
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
   * Opts the available-locales widget into the sidebar (below the path
   * widget). Sourced from `CollectionDefinition.advertiseLocales` by the
   * caller. When true, one checkbox per content locale renders, reconciled
   * against the document's `_availableVersionLocales` ledger fact.
   */
  advertiseLocales?: boolean
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

const FormStatusDisplay = ({
  initialData,
  workflowStatuses,
  publishedVersion,
  onUnpublish,
}: {
  initialData?: Record<string, any>
  workflowStatuses?: WorkflowStatus[]
  publishedVersion?: PublishedVersionInfo | null
  onUnpublish?: () => Promise<void>
}) => {
  const { t } = useTranslation('byline-admin')
  const statusCode = initialData?.status
  const statusLabel = workflowStatuses?.find((s) => s.name === statusCode)?.label ?? statusCode
  // Single-status workflows (e.g. lookups) have no editorial lifecycle —
  // suppress the "Status: …" cell since there is nothing meaningful to convey.
  const showStatusCell = (workflowStatuses?.length ?? 0) > 1

  return (
    <div className={cx('byline-form-status', styles.status)}>
      <div className={cx('byline-form-status-meta', styles['status-meta'])}>
        {showStatusCell && (
          <div className={cx('byline-form-status-cell', styles['status-cell'])}>
            <span className={cx('byline-form-status-muted', styles['status-muted'])}>
              {t('forms.status.label')}
            </span>
            <span className={cx('byline-form-status-trunc', styles['status-trunc'])}>
              {statusLabel}
            </span>
          </div>
        )}

        {initialData?.updatedAt != null && (
          <div className={cx('byline-form-status-cell', styles['status-cell'])}>
            <span className={cx('byline-form-status-muted', styles['status-muted'])}>
              {t('forms.status.lastModified')}
            </span>
            <span className={cx('byline-form-status-trunc', styles['status-trunc'])}>
              <LocalDateTime value={initialData.updatedAt} />
            </span>
          </div>
        )}

        {initialData?.createdAt != null && (
          <div className={cx('byline-form-status-cell', styles['status-cell'])}>
            <span className={cx('byline-form-status-muted', styles['status-muted'])}>
              {t('forms.status.created')}
            </span>
            <span className={cx('byline-form-status-trunc', styles['status-trunc'])}>
              <LocalDateTime value={initialData.createdAt} />
            </span>
          </div>
        )}
      </div>

      {publishedVersion != null && (
        <div className={cx('byline-form-status-published', styles['status-published'])}>
          <span className={cx('byline-form-status-muted', styles['status-muted'])}>
            {t('forms.status.publishedLive')}{' '}
            {publishedVersion.updatedAt ? (
              <span>
                {t('forms.status.publishedOn', { date: new Date(publishedVersion.updatedAt) })}
              </span>
            ) : (
              ''
            )}
          </span>
          {onUnpublish && (
            <>
              {' '}
              <button
                type="button"
                onClick={onUnpublish}
                className={cx('byline-form-status-unpublish', styles['status-unpublish'])}
              >
                {t('common.actions.unpublish')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Compute the primary and secondary status transitions for the ComboButton.
 * - Primary: the main action (forward step), or the current status itself
 *   when the document has reached the final workflow step (terminal state).
 * - Secondary: other available transitions to show as dropdown options.
 * - isTerminal: true when the document is at the final workflow status —
 *   the primary button renders as a non-actionable indicator and all
 *   back-steps move into the dropdown.
 */
function computeStatusTransitions(
  currentStatus: string | undefined,
  workflowStatuses: WorkflowStatus[] | undefined,
  nextStatus: WorkflowStatus | undefined
): {
  primaryStatus: WorkflowStatus | undefined
  secondaryStatuses: WorkflowStatus[]
  isTerminal: boolean
} {
  if (!workflowStatuses || workflowStatuses.length === 0 || !currentStatus) {
    return { primaryStatus: nextStatus, secondaryStatuses: [], isTerminal: false }
  }

  // Single-status workflows (e.g. SINGLE_STATUS_WORKFLOW for lookups) have
  // no transitions — short-circuit so the form shows only Close / Save.
  if (workflowStatuses.length <= 1) {
    return { primaryStatus: undefined, secondaryStatuses: [], isTerminal: false }
  }

  const currentIndex = workflowStatuses.findIndex((s) => s.name === currentStatus)
  if (currentIndex === -1) {
    return { primaryStatus: nextStatus, secondaryStatuses: [], isTerminal: false }
  }

  const isAtEnd = currentIndex === workflowStatuses.length - 1
  const isAtStart = currentIndex === 0

  // Collect all available target statuses
  const availableTargets: WorkflowStatus[] = []

  // Reset to first (if not at first)
  if (!isAtStart && workflowStatuses[0]) {
    availableTargets.push(workflowStatuses[0])
  }

  // Back one step (if not at start and the previous is not already the first)
  const prev = workflowStatuses[currentIndex - 1]
  if (currentIndex > 1 && prev) {
    availableTargets.push(prev)
  }

  // Forward one step (if not at end) - this is the nextStatus
  const next = workflowStatuses[currentIndex + 1]
  if (!isAtEnd && next) {
    availableTargets.push(next)
  }

  if (isAtEnd) {
    // Terminal state: the primary button is a non-actionable indicator of the
    // current status; both back-steps (revert to previous / reset to first)
    // are surfaced in the dropdown.
    return {
      primaryStatus: workflowStatuses[currentIndex],
      secondaryStatuses: availableTargets,
      isTerminal: true,
    }
  }

  // Not at end: primary is the forward step (nextStatus)
  return {
    primaryStatus: nextStatus,
    secondaryStatuses: availableTargets.filter((s) => s.name !== nextStatus?.name),
    isTerminal: false,
  }
}

const FormContent = ({
  mode,
  fields,
  onSubmit,
  onCancel,
  onStatusChange,
  onUnpublish,
  onDelete,
  onDuplicate,
  onCopyToLocale,
  contentLocales,
  nextStatus,
  workflowStatuses,
  publishedVersion,
  initialData,
  adminConfig,
  useAsTitle,
  useAsPath,
  advertiseLocales,
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
  const {
    getFieldValues,
    runFieldHooks,
    validateForm,
    errors: initialErrors,
    hasChanges: hasChangesFn,
    resetHasChanges,
    getPatches,
    getSystemPath,
    getSystemAvailableLocales,
    subscribeErrors,
    subscribeMeta,
    setFieldValue,
    setFieldError,
    getPendingUploads,
    clearPendingUploads,
    setFieldUploading,
  } = useFormContext()
  const { t } = useTranslation('byline-admin')

  const [errors, setErrors] = useState(initialErrors)
  const [hasChanges, setHasChanges] = useState(hasChangesFn())
  const [statusBusy, setStatusBusy] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  // Block-only "save first" guard. Set true when the editor triggers a
  // guarded action (status change, duplicate, copy-to-locale) while the form
  // is dirty — those actions operate on the saved version, so unsaved edits
  // would be silently excluded.
  const [showUnsavedModal, setShowUnsavedModal] = useState(false)
  const [contentLocale, setContentLocale] = useState(initialLocale ?? defaultLocale)
  const { uploadField } = useBylineFieldServices()

  // Sync contentLocale when the route re-fetches with a different locale.
  useEffect(() => {
    if (initialLocale) setContentLocale(initialLocale)
  }, [initialLocale])

  // ---------------------------------------------------------------------
  // Layout primitives + lookup tables.
  //
  // Built once per render from `adminConfig`. The validator at startup
  // guarantees every reachable name resolves and every schema field is
  // placed at most once, so render-time lookups are unguarded.
  // ---------------------------------------------------------------------

  const fieldByName = useMemo(() => {
    const map = new Map<string, Field>()
    for (const field of fields) {
      if ('name' in field) map.set(field.name, field)
    }
    return map
  }, [fields])

  const tabSetByName = useMemo(() => {
    const map = new Map<string, TabSetDefinition>()
    for (const set of adminConfig?.tabSets ?? []) map.set(set.name, set)
    return map
  }, [adminConfig])

  const rowByName = useMemo(() => {
    const map = new Map<string, RowDefinition>()
    for (const row of adminConfig?.rows ?? []) map.set(row.name, row)
    return map
  }, [adminConfig])

  const groupByName = useMemo(() => {
    const map = new Map<string, GroupDefinition>()
    for (const group of adminConfig?.groups ?? []) map.set(group.name, group)
    return map
  }, [adminConfig])

  // When `layout` is omitted, synthesise main = all schema fields in order.
  const layout = useMemo(() => {
    if (adminConfig?.layout) return adminConfig.layout
    return { main: fields.filter((f) => 'name' in f).map((f) => (f as { name: string }).name) }
  }, [adminConfig, fields])

  // Reverse index: schema field name → which tab set + tab it lives in.
  // Powers per-tab-set error badge counts. Fields not under any tab set
  // (e.g. raw-field placement directly in `layout.main`) are absent from
  // this map.
  const fieldToTabPath = useMemo(() => {
    const map = new Map<string, { tabSetName: string; tabName: string }>()
    const visit = (
      names: readonly string[],
      tabSetName: string,
      tabName: string,
      seen: Set<string>
    ) => {
      for (const name of names) {
        if (fieldByName.has(name)) {
          map.set(name, { tabSetName, tabName })
        } else if (seen.has(name)) {
        } else if (rowByName.has(name)) {
          const row = rowByName.get(name)!
          const next = new Set(seen).add(name)
          visit(row.fields, tabSetName, tabName, next)
        } else if (groupByName.has(name)) {
          const group = groupByName.get(name)!
          const next = new Set(seen).add(name)
          visit(group.fields, tabSetName, tabName, next)
        }
      }
    }
    for (const set of adminConfig?.tabSets ?? []) {
      for (const tab of set.tabs) {
        visit(tab.fields, set.name, tab.name, new Set())
      }
    }
    return map
  }, [adminConfig, fieldByName, rowByName, groupByName])

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

  // Track live form data so TabDefinition.condition functions can react to
  // field changes. Re-evaluated per keystroke via the meta-subscribe loop.
  const [formData, setFormData] = useState<Record<string, any>>(() => getFieldValues())

  // Live document heading — tracks the useAsTitle field as the user types
  const liveTitle = useFieldValue<string>(useAsTitle ?? '')
  const heading =
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
  const guard = useGuard(hasChanges)

  // Compute available status transitions
  const currentStatus = initialData?.status
  const { primaryStatus, secondaryStatuses, isTerminal } = computeStatusTransitions(
    currentStatus,
    workflowStatuses,
    nextStatus
  )

  useEffect(() => {
    return subscribeErrors((newErrors) => setErrors(newErrors))
  }, [subscribeErrors])

  useEffect(() => {
    return subscribeMeta(() => setHasChanges(hasChangesFn()))
  }, [subscribeMeta, hasChangesFn])

  // Keep formData in sync for evaluating TabDefinition.condition functions
  useEffect(() => {
    return subscribeMeta(() => setFormData(getFieldValues()))
  }, [subscribeMeta, getFieldValues])

  const handleCancel = () => {
    if (onCancel && typeof onCancel === 'function') {
      onCancel()
    }
  }

  const handleSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()

    // Run field-level beforeValidate hooks (submit-time), then validate
    void (async () => {
      const hookErrors = await runFieldHooks(fields)
      const formErrors = validateForm(fields)
      const allErrors = [...hookErrors, ...formErrors]

      if (allErrors.length > 0) {
        console.error('Form validation failed:', allErrors)
        return
      }

      // Execute any pending uploads before submitting
      const pendingUploads = getPendingUploads()
      if (pendingUploads.size > 0) {
        setIsUploading(true)
        try {
          const uploadResult = await executeUploadsWithProgress(
            pendingUploads,
            uploadField,
            ({ fieldPath, status }) => {
              setFieldUploading(fieldPath, status === 'uploading')
            }
          )

          // Check for upload errors
          if (!uploadResult.allSucceeded) {
            // Set field-level errors for failed uploads
            for (const [fieldPath, errorMessage] of uploadResult.errors.entries()) {
              setFieldError(fieldPath, t('forms.uploadFailedFieldError', { message: errorMessage }))
            }
            console.error('One or more uploads failed:', uploadResult.errors)
            setIsUploading(false)
            return
          }

          // Replace pending StoredFileValues with real ones in form data
          for (const [fieldPath, storedFile] of uploadResult.successful.entries()) {
            setFieldValue(fieldPath, storedFile)
          }

          // Clear pending uploads (blob URLs already revoked by clearPendingUploads)
          clearPendingUploads()
        } catch (err) {
          console.error('Upload execution error:', err)
          setIsUploading(false)
          return
        }
        setIsUploading(false)
      }

      const data = getFieldValues()
      const patches = getPatches()
      const systemPath = getSystemPath()
      // Only emit the advertised-locale set for collections that opted into the
      // widget — otherwise leave it undefined so the write path never touches
      // `byline_document_available_locales` for non-advertising collections.
      const systemAvailableLocales = advertiseLocales ? getSystemAvailableLocales() : undefined

      if (onSubmit && typeof onSubmit === 'function') {
        onSubmit({ data, patches, systemPath, systemAvailableLocales })
        resetHasChanges()
      }
    })()
  }

  // Per-tab-set error counts: { [tabSetName]: { [tabName]: count } }.
  // Each <Tabs> bar consumes its own slice.
  const tabErrorCountsBySet = useMemo<Record<string, Record<string, number>>>(() => {
    const result: Record<string, Record<string, number>> = {}
    for (const err of errors) {
      const path = fieldToTabPath.get(err.field)
      if (!path) continue
      result[path.tabSetName] ??= {}
      result[path.tabSetName]![path.tabName] = (result[path.tabSetName]?.[path.tabName] ?? 0) + 1
    }
    return result
  }, [errors, fieldToTabPath])

  // -------------------------------------------------------------------
  // Layout walk — recursively dispatches each name in a region to the
  // appropriate primitive renderer or to <FieldRenderer>.
  // -------------------------------------------------------------------

  const renderField = (fieldName: string): ReactNode => {
    const field = fieldByName.get(fieldName)
    if (!field) return null
    return (
      <FieldRenderer
        key={field.name}
        field={field}
        defaultValue={initialData?.fields?.[field.name]}
        collectionPath={collectionPath}
        contentLocale={contentLocale}
        components={adminConfig?.fields?.[field.name]?.components}
        editor={adminConfig?.fields?.[field.name]?.editor}
      />
    )
  }

  const renderItem = (name: string): ReactNode => {
    const tabSet = tabSetByName.get(name)
    if (tabSet) return renderTabSet(tabSet)

    const group = groupByName.get(name)
    if (group) return renderGroup(group)

    const row = rowByName.get(name)
    if (row) return renderRow(row)

    return renderField(name)
  }

  const renderRow = (row: RowDefinition): ReactNode => (
    <AdminRow key={`row:${row.name}`}>{row.fields.map((name) => renderField(name))}</AdminRow>
  )

  const renderGroup = (group: GroupDefinition): ReactNode => (
    <AdminGroup key={`group:${group.name}`} label={group.label}>
      {group.fields.map((name) => renderItem(name))}
    </AdminGroup>
  )

  const renderTabSet = (set: TabSetDefinition): ReactNode => {
    const visibleTabs = set.tabs.filter((tab) => !tab.condition || tab.condition(formData))
    const requested = activeTabBySet[set.name] ?? ''
    const resolvedActive =
      visibleTabs.length > 0 && !visibleTabs.some((t) => t.name === requested)
        ? (visibleTabs[0]?.name ?? requested)
        : requested
    const activeTab = visibleTabs.find((t) => t.name === resolvedActive)

    return (
      <div key={`tabset:${set.name}`} className={cx('byline-form-tabset', styles.tabset)}>
        {visibleTabs.length > 0 && (
          <AdminTabs
            tabs={visibleTabs}
            activeTab={resolvedActive}
            onChange={(tabName) => handleTabChange(set.name, tabName)}
            errorCounts={tabErrorCountsBySet[set.name]}
            className={cx('byline-form-tabset-tabs', styles['tabset-tabs'])}
          />
        )}
        {activeTab && (
          <div className={cx('byline-form-tabset-fields', styles['tabset-fields'])}>
            {activeTab.fields.map((name) => renderItem(name))}
          </div>
        )}
      </div>
    )
  }

  return (
    <form noValidate onSubmit={handleSubmit} className={cx('byline-form', styles.form)}>
      <div className={cx('byline-form-heading-row', styles['heading-row'])}>
        <h1 className={cx('byline-form-heading', styles.heading)}>{heading}</h1>
        {/* Source-locale anchor indicator removed pending heading-layout work.
            To re-enable: render `<SourceLocaleBadge locale={sourceLocale} />`
            here from `initialData.sourceLocale` (mismatch-only is the intended
            end state). See docs/I18N.md. */}
        {headerSlot}
      </div>
      <div className={cx('byline-form-status-bar', styles['status-bar'])}>
        <FormStatusDisplay
          initialData={initialData}
          workflowStatuses={workflowStatuses}
          publishedVersion={publishedVersion}
          onUnpublish={onUnpublish}
        />
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
            disabled={hasChanges === false || isUploading}
          >
            {isUploading ? t('forms.actions.uploading') : t('common.actions.save')}
          </Button>
          {primaryStatus && onStatusChange && (
            <div className={cx('byline-form-actions-status-wrap', styles['actions-status-wrap'])}>
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
                disabled={statusBusy}
                onOptionSelect={async (value: string) => {
                  if (hasChanges) {
                    setShowUnsavedModal(true)
                    return
                  }
                  setStatusBusy(true)
                  try {
                    await onStatusChange(value)
                  } finally {
                    setStatusBusy(false)
                  }
                }}
                onButtonClick={
                  isTerminal
                    ? undefined
                    : async () => {
                        if (hasChanges) {
                          setShowUnsavedModal(true)
                          return
                        }
                        setStatusBusy(true)
                        try {
                          await onStatusChange(primaryStatus.name)
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
          />
        </div>
      </div>
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
      <div className={cx('byline-form-layout', styles.layout)}>
        <div className={cx('byline-form-content', styles.content)}>
          {layout.main.map((name) => renderItem(name))}
        </div>
        <div className={cx('byline-form-sidebar', styles.sidebar)}>
          {(useAsPath ||
            (typeof initialData?.path === 'string' && initialData.path.length > 0)) && (
            <PathWidget
              useAsPath={useAsPath}
              collectionPath={collectionPath ?? ''}
              defaultLocale={defaultLocale}
              activeLocale={contentLocale}
              mode={mode}
            />
          )}
          {advertiseLocales && (
            <AvailableLocalesWidget
              contentLocales={contentLocales ?? []}
              availableVersionLocales={
                (initialData?._availableVersionLocales as string[] | undefined) ?? []
              }
            />
          )}
          {(layout.sidebar ?? []).map((name) => renderItem(name))}
        </div>
      </div>
      {showUnsavedModal && (
        <Modal
          isOpen={true}
          closeOnOverlayClick={true}
          onDismiss={() => setShowUnsavedModal(false)}
        >
          <Modal.Container style={{ maxWidth: '460px' }}>
            <Modal.Header
              className={cx('byline-form-guard-modal-head', styles['guard-modal-head'])}
            >
              <h3 className={cx('byline-form-guard-modal-title', styles['guard-modal-title'])}>
                {t('forms.unsavedChanges.title')}
              </h3>
            </Modal.Header>
            <Modal.Content>
              <p className={cx('byline-form-guard-modal-text', styles['guard-modal-text'])}>
                {t('forms.unsavedChanges.message')}
              </p>
            </Modal.Content>
            <Modal.Actions>
              <Button
                size="sm"
                style={{ minWidth: '60px' }}
                intent="primary"
                type="button"
                onClick={() => setShowUnsavedModal(false)}
              >
                {t('forms.unsavedChanges.okButton')}
              </Button>
            </Modal.Actions>
          </Modal.Container>
        </Modal>
      )}
      {guard.isBlocked && (
        <Modal isOpen={true} closeOnOverlayClick={false} onDismiss={guard.stay}>
          <Modal.Container style={{ maxWidth: '460px' }}>
            <Modal.Header
              className={cx('byline-form-guard-modal-head', styles['guard-modal-head'])}
            >
              <h3 className={cx('byline-form-guard-modal-title', styles['guard-modal-title'])}>
                {t('forms.navigationGuard.title')}
              </h3>
            </Modal.Header>
            <Modal.Content>
              <p className={cx('byline-form-guard-modal-text', styles['guard-modal-text'])}>
                {t('forms.navigationGuard.message')}
              </p>
            </Modal.Content>
            <Modal.Actions>
              <Button size="sm" intent="noeffect" type="button" onClick={guard.stay}>
                {t('forms.navigationGuard.stayButton')}
              </Button>
              <Button size="sm" intent="danger" type="button" onClick={guard.proceed}>
                {t('forms.navigationGuard.leaveButton')}
              </Button>
            </Modal.Actions>
          </Modal.Container>
        </Modal>
      )}
    </form>
  )
}

export const FormRenderer = ({
  mode,
  fields,
  onSubmit,
  onCancel,
  onStatusChange,
  onUnpublish,
  onDelete,
  onDuplicate,
  onCopyToLocale,
  contentLocales,
  nextStatus,
  workflowStatuses,
  publishedVersion,
  initialData,
  adminConfig,
  useAsTitle,
  useAsPath,
  advertiseLocales,
  headingLabel,
  headerSlot,
  collectionPath,
  initialLocale,
  onLocaleChange,
  defaultLocale,
  useNavigationGuard,
  restoreWarnings,
}: FormRendererProps) => {
  // Persists per-tab-set active tab across locale-change remounts of FormContent.
  // useRef so mutations never trigger a re-render of FormRenderer itself.
  const savedTabsRef = useRef<Record<string, string>>({})

  return (
    <FormProvider
      key={`${initialLocale ?? 'default'}-${initialData?.versionId ?? ''}`}
      initialData={initialData}
    >
      <FormContent
        mode={mode}
        fields={fields}
        onSubmit={onSubmit}
        onCancel={onCancel}
        onStatusChange={onStatusChange}
        onUnpublish={onUnpublish}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onCopyToLocale={onCopyToLocale}
        contentLocales={contentLocales}
        nextStatus={nextStatus}
        workflowStatuses={workflowStatuses}
        publishedVersion={publishedVersion}
        initialData={initialData}
        adminConfig={adminConfig}
        useAsTitle={useAsTitle}
        useAsPath={useAsPath}
        advertiseLocales={advertiseLocales}
        headingLabel={headingLabel}
        headerSlot={headerSlot}
        collectionPath={collectionPath}
        initialLocale={initialLocale}
        onLocaleChange={onLocaleChange}
        defaultLocale={defaultLocale}
        useNavigationGuard={useNavigationGuard}
        restoreWarnings={restoreWarnings}
        _activeTabBySet={savedTabsRef.current}
        _onTabChange={(tabSetName, tabName) => {
          savedTabsRef.current = { ...savedTabsRef.current, [tabSetName]: tabName }
        }}
      />
    </FormProvider>
  )
}
