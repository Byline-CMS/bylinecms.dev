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
import { Button, ComboButton, Modal } from '@infonomic/uikit/react'
import cx from 'classnames'

import { Group } from '../admin/group'
import { Row } from '../admin/row'
import { Tabs } from '../admin/tabs'
import { FieldRenderer } from '../fields/field-renderer'
import { LocalDateTime } from '../fields/local-date-time'
import { useBylineFieldServices } from '../services/field-services-context'
import { DocumentActions } from './document-actions'
import { FormProvider, useFieldValue, useFormContext } from './form-context'
import styles from './form-renderer.module.css'
import { useNavigationGuardAdapter } from './navigation-guard'
import { PathWidget } from './path-widget'
import { executeUploads } from './upload-executor'
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
  headingLabel?: string
  headerSlot?: ReactNode
  /** Collection path forwarded to upload-capable fields (e.g. `'media'`). */
  collectionPath?: string
  /** The active content locale — initialised from the route query string. */
  initialLocale?: string
  /** Called when the user picks a different content locale. */
  onLocaleChange?: (locale: string) => void
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
            <span className={cx('byline-form-status-muted', styles['status-muted'])}>Status:</span>
            <span className={cx('byline-form-status-trunc', styles['status-trunc'])}>
              {statusLabel}
            </span>
          </div>
        )}

        {initialData?.updatedAt != null && (
          <div className={cx('byline-form-status-cell', styles['status-cell'])}>
            <span className={cx('byline-form-status-muted', styles['status-muted'])}>
              Last modified:
            </span>
            <span className={cx('byline-form-status-trunc', styles['status-trunc'])}>
              <LocalDateTime value={initialData.updatedAt} />
            </span>
          </div>
        )}

        {initialData?.createdAt != null && (
          <div className={cx('byline-form-status-cell', styles['status-cell'])}>
            <span className={cx('byline-form-status-muted', styles['status-muted'])}>Created:</span>
            <span className={cx('byline-form-status-trunc', styles['status-trunc'])}>
              <LocalDateTime value={initialData.createdAt} />
            </span>
          </div>
        )}
      </div>

      {publishedVersion != null && (
        <div className={cx('byline-form-status-published', styles['status-published'])}>
          <span className={cx('byline-form-status-muted', styles['status-muted'])}>
            A published version is currently live.{' '}
            {publishedVersion.updatedAt ? (
              <span>
                Published on <LocalDateTime value={publishedVersion.updatedAt} />
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
                Unpublish
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
 * - Primary: the main action (forward step, or back step if at the end)
 * - Secondary: other available transitions to show as dropdown options
 */
function computeStatusTransitions(
  currentStatus: string | undefined,
  workflowStatuses: WorkflowStatus[] | undefined,
  nextStatus: WorkflowStatus | undefined
): {
  primaryStatus: WorkflowStatus | undefined
  secondaryStatuses: WorkflowStatus[]
} {
  if (!workflowStatuses || workflowStatuses.length === 0 || !currentStatus) {
    return { primaryStatus: nextStatus, secondaryStatuses: [] }
  }

  // Single-status workflows (e.g. SINGLE_STATUS_WORKFLOW for lookups) have
  // no transitions — short-circuit so the form shows only Close / Save.
  if (workflowStatuses.length <= 1) {
    return { primaryStatus: undefined, secondaryStatuses: [] }
  }

  const currentIndex = workflowStatuses.findIndex((s) => s.name === currentStatus)
  if (currentIndex === -1) {
    return { primaryStatus: nextStatus, secondaryStatuses: [] }
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
  if (currentIndex > 1 && workflowStatuses[currentIndex - 1]) {
    availableTargets.push(workflowStatuses[currentIndex - 1])
  }

  // Forward one step (if not at end) - this is the nextStatus
  if (!isAtEnd && workflowStatuses[currentIndex + 1]) {
    availableTargets.push(workflowStatuses[currentIndex + 1])
  }

  // Determine primary and secondary
  let primaryStatus: WorkflowStatus | undefined
  let secondaryStatuses: WorkflowStatus[]

  if (isAtEnd) {
    // At the last status: primary is the back step (previous status)
    const prevStatus = workflowStatuses[currentIndex - 1]
    primaryStatus = prevStatus
    secondaryStatuses = availableTargets.filter((s) => s.name !== prevStatus?.name)
  } else {
    // Not at end: primary is the forward step (nextStatus)
    primaryStatus = nextStatus
    secondaryStatuses = availableTargets.filter((s) => s.name !== nextStatus?.name)
  }

  return { primaryStatus, secondaryStatuses }
}

const FormContent = ({
  mode,
  fields,
  onSubmit,
  onCancel,
  onStatusChange,
  onUnpublish,
  onDelete,
  nextStatus,
  workflowStatuses,
  publishedVersion,
  initialData,
  adminConfig,
  useAsTitle,
  useAsPath,
  headingLabel,
  headerSlot,
  collectionPath,
  initialLocale,
  onLocaleChange,
  defaultLocale = 'en',
  useNavigationGuard: useNavigationGuardProp,
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
    subscribeErrors,
    subscribeMeta,
    setFieldValue,
    setFieldError,
    getPendingUploads,
    clearPendingUploads,
  } = useFormContext()

  const [errors, setErrors] = useState(initialErrors)
  const [hasChanges, setHasChanges] = useState(hasChangesFn())
  const [statusBusy, setStatusBusy] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
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
      ? `${mode === 'create' ? 'Create' : 'Edit'} ${headingLabel}`
      : mode === 'create'
        ? 'Create'
        : 'Edit')

  // Navigation guard — block router navigation and browser unload when dirty.
  // The guard hook is injected by the consuming framework (prop > context > no-op fallback).
  const guardFromContext = useNavigationGuardAdapter()
  const useGuard = useNavigationGuardProp ?? guardFromContext
  const guard = useGuard(hasChanges)

  // Compute available status transitions
  const currentStatus = initialData?.status
  const { primaryStatus, secondaryStatuses } = computeStatusTransitions(
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
          const uploadResult = await executeUploads(pendingUploads, uploadField)

          // Check for upload errors
          if (!uploadResult.allSucceeded) {
            // Set field-level errors for failed uploads
            for (const [fieldPath, errorMessage] of uploadResult.errors.entries()) {
              setFieldError(fieldPath, `Upload failed: ${errorMessage}`)
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

      if (onSubmit && typeof onSubmit === 'function') {
        onSubmit({ data, patches, systemPath })
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
    <Row key={`row:${row.name}`}>{row.fields.map((name) => renderField(name))}</Row>
  )

  const renderGroup = (group: GroupDefinition): ReactNode => (
    <Group key={`group:${group.name}`} label={group.label}>
      {group.fields.map((name) => renderItem(name))}
    </Group>
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
          <Tabs
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
            {hasChanges === false ? 'Close' : 'Cancel'}
          </Button>
          <Button
            className={cx('byline-form-actions-button', styles['actions-button'])}
            size="sm"
            type="submit"
            disabled={hasChanges === false || isUploading}
          >
            {isUploading ? 'Uploading…' : 'Save'}
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
                  label: s.verb ?? s.label ?? s.name,
                  value: s.name,
                }))}
                sideOffset={5}
                size="sm"
                type="button"
                intent="success"
                disabled={statusBusy}
                onOptionSelect={async (value: string) => {
                  setStatusBusy(true)
                  try {
                    await onStatusChange(value)
                  } finally {
                    setStatusBusy(false)
                  }
                }}
                onButtonClick={async () => {
                  setStatusBusy(true)
                  try {
                    await onStatusChange(primaryStatus.name)
                  } finally {
                    setStatusBusy(false)
                  }
                }}
              >
                {statusBusy
                  ? '...'
                  : (primaryStatus.verb ?? primaryStatus.label ?? primaryStatus.name)}
              </ComboButton>
            </div>
          )}
          <DocumentActions
            publishedVersion={publishedVersion}
            onUnpublish={onUnpublish}
            onDelete={onDelete}
          />
        </div>
      </div>
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
              mode={mode}
            />
          )}
          {(layout.sidebar ?? []).map((name) => renderItem(name))}
        </div>
      </div>
      {guard.isBlocked && (
        <Modal isOpen={true} closeOnOverlayClick={false} onDismiss={guard.stay}>
          <Modal.Container style={{ maxWidth: '460px' }}>
            <Modal.Header
              className={cx('byline-form-guard-modal-head', styles['guard-modal-head'])}
            >
              <h3 className={cx('byline-form-guard-modal-title', styles['guard-modal-title'])}>
                Leave without saving?
              </h3>
            </Modal.Header>
            <Modal.Content>
              <p className={cx('byline-form-guard-modal-text', styles['guard-modal-text'])}>
                Your changes have not been saved. If you leave now, you will lose your changes.
              </p>
            </Modal.Content>
            <Modal.Actions>
              <Button size="sm" intent="noeffect" type="button" onClick={guard.stay}>
                Stay on this page
              </Button>
              <Button size="sm" intent="danger" type="button" onClick={guard.proceed}>
                Leave anyway
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
  nextStatus,
  workflowStatuses,
  publishedVersion,
  initialData,
  adminConfig,
  useAsTitle,
  useAsPath,
  headingLabel,
  headerSlot,
  collectionPath,
  initialLocale,
  onLocaleChange,
  defaultLocale,
  useNavigationGuard,
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
        nextStatus={nextStatus}
        workflowStatuses={workflowStatuses}
        publishedVersion={publishedVersion}
        initialData={initialData}
        adminConfig={adminConfig}
        useAsTitle={useAsTitle}
        useAsPath={useAsPath}
        headingLabel={headingLabel}
        headerSlot={headerSlot}
        collectionPath={collectionPath}
        initialLocale={initialLocale}
        onLocaleChange={onLocaleChange}
        defaultLocale={defaultLocale}
        useNavigationGuard={useNavigationGuard}
        _activeTabBySet={savedTabsRef.current}
        _onTabChange={(tabSetName, tabName) => {
          savedTabsRef.current = { ...savedTabsRef.current, [tabSetName]: tabName }
        }}
      />
    </FormProvider>
  )
}
