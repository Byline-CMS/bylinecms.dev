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
import { getClientConfig } from '@byline/core'
import type { DocumentPatch } from '@byline/core/patches'
import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, ComboButton } from '@byline/ui/react'
import cx from 'classnames'

import { sliceFieldAdmin } from '../fields/field-admin'
import { FieldRenderer } from '../fields/field-renderer'
import { useBylineFieldServices } from '../fields/field-services-context'
import { AdminGroup } from '../presentation/group'
import { AdminRow } from '../presentation/row'
import { AdminTabs } from '../presentation/tabs'
import { AvailableLocalesWidget } from './available-locales-widget'
import { DocumentActions, type DocumentActionsLocaleOption } from './document-actions'
import { FormProvider, useFieldValue, useFormContext } from './form-context'
import { NavigationGuardModal, SystemFieldsConfirmModal, UnsavedChangesModal } from './form-modals'
import styles from './form-renderer.module.css'
import { FormStatusDisplay } from './form-status-display'
import { useNavigationGuardAdapter } from './navigation-guard'
import { PathWidget } from './path-widget'
import { computeStatusTransitions } from './status-transitions'
import { TreePlacementWidget } from './tree-placement-widget'
import { executeUploadsWithProgress } from './upload-executor'
import { useFormLayout } from './use-form-layout'
import type { UseNavigationGuard } from './navigation-guard'

/** Metadata about a previously published version that is still live. */
export interface PublishedVersionInfo {
  id: string
  versionId: string
  status: string
  createdAt: string | Date
  updatedAt: string | Date
}

/**
 * Payload emitted by the form on Save. Carries the content (field data +
 * patches) alongside the document-grain system fields (path / advertised
 * locales) and per-bucket dirty flags so the host can route each piece to the
 * right write path — versioned for content, immediate/non-versioned for the
 * system fields. See docs/07-internationalization/index.md.
 */
export interface SystemFieldsSubmitPayload {
  // biome-ignore lint/suspicious/noExplicitAny: data is collection-specific
  data: any
  patches: DocumentPatch[]
  contentDirty: boolean
  pathDirty: boolean
  systemPath?: string | null
  availableLocalesDirty: boolean
  systemAvailableLocales?: string[]
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
  fields,
  onSubmit,
  onCancel,
  onStatusChange,
  onUnpublish,
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
  const {
    getFieldValues,
    runFieldHooks,
    validateForm,
    errors: initialErrors,
    hasChanges: hasChangesFn,
    resetHasChanges,
    getPatches,
    getDirtyBreakdown,
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
  // Holds the pending Save payload while the editor confirms an immediate,
  // non-versioned system-field write (path / advertised locales). Non-null
  // means the confirmation modal is open. See docs/07-internationalization/index.md.
  const [pendingSystemFieldsSubmit, setPendingSystemFieldsSubmit] =
    useState<SystemFieldsSubmitPayload | null>(null)
  const [contentLocale, setContentLocale] = useState(initialLocale ?? defaultLocale)
  const { uploadField } = useBylineFieldServices()

  // Path-widget wiring. The live preview must use the installation's
  // client-side slugifier (same function as `ServerConfig.slugifier`) so it
  // agrees with the persisted path. And when the `useAsPath` source is a
  // server-assigned `counter` or a read-only field, its value can't be
  // reproduced or changed through the form, so the widget suppresses its
  // source-derived preview and "Regenerate" affordance.
  const pathSlugifier = getClientConfig().slugifier
  const pathSourceLocked = useMemo(() => {
    if (!useAsPath) return false
    const source = fields.find((f) => f.name === useAsPath)
    return source != null && (source.type === 'counter' || source.readOnly === true)
  }, [useAsPath, fields])

  // Sync contentLocale when the route re-fetches with a different locale.
  useEffect(() => {
    if (initialLocale) setContentLocale(initialLocale)
  }, [initialLocale])

  // Layout primitives + lookup tables — pure derivations of `adminConfig` +
  // `fields`. The validator at startup guarantees every reachable name
  // resolves and every schema field is placed at most once, so the render-time
  // lookups below are unguarded. See ./use-form-layout.
  const { fieldByName, tabSetByName, rowByName, groupByName, layout, fieldToTabPath } =
    useFormLayout(adminConfig, fields)

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

  // Emit the payload and optimistically clear dirty state (parity with the
  // prior submit behaviour — the host surfaces failures via toast).
  const submitPayload = useCallback(
    (payload: SystemFieldsSubmitPayload) => {
      if (onSubmit && typeof onSubmit === 'function') {
        onSubmit(payload)
        resetHasChanges()
      }
    },
    [onSubmit, resetHasChanges]
  )

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
            },
            {
              // Document context for server-side upload hooks: the persisted
              // document id (edit mode only) plus any `upload.context` form
              // values declared on the schema field. See UploadConfig.context
              // in @byline/core.
              documentId:
                mode === 'edit' && typeof initialData?.id === 'string' ? initialData.id : undefined,
              fields,
              getFormValues: getFieldValues,
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
      const { contentDirty, pathDirty, availableLocalesDirty, reason } = getDirtyBreakdown()
      const systemPath = getSystemPath()
      // Only emit the advertised-locale set for collections that opted into the
      // widget — otherwise leave it undefined so the write path never touches
      // `byline_document_available_locales` for non-advertising collections.
      const systemAvailableLocales = advertiseLocales ? getSystemAvailableLocales() : undefined

      const payload: SystemFieldsSubmitPayload = {
        data,
        patches,
        contentDirty,
        pathDirty,
        systemPath,
        availableLocalesDirty,
        systemAvailableLocales,
      }

      // Editing the document-grain system fields (path / advertised locales) is
      // an immediate, non-versioned write that does NOT reset workflow status,
      // so confirm it before saving. Create mode writes everything as part of
      // the initial version, so no confirmation applies there.
      if (mode === 'edit' && (reason === 'direct-write' || reason === 'both')) {
        setPendingSystemFieldsSubmit(payload)
        return
      }

      submitPayload(payload)
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
        contentLocale={contentLocale}
        components={adminConfig?.fields?.[field.name]?.components}
        editor={adminConfig?.fields?.[field.name]?.editor}
        fieldAdmin={sliceFieldAdmin(adminConfig?.fields, field.name)}
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
    <form
      method="post"
      noValidate
      onSubmit={handleSubmit}
      className={cx('byline-form', styles.form)}
    >
      <div className={cx('byline-form-heading-row', styles['heading-row'])}>
        <h1 className={cx('byline-form-heading', styles.heading)}>{heading}</h1>
        {/* Source-locale anchor indicator removed pending heading-layout work.
            To re-enable: render `<SourceLocaleBadge locale={sourceLocale} />`
            here from `initialData.sourceLocale` (mismatch-only is the intended
            end state). See docs/07-internationalization/index.md. */}
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
            onDeleteLocale={onDeleteLocale}
            defaultLocale={defaultLocale}
            availableLocales={initialData?._availableVersionLocales as string[] | undefined}
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
              slugifier={pathSlugifier}
              sourceLocked={pathSourceLocked}
            />
          )}
          {tree && mode === 'edit' && typeof initialData?.id === 'string' && (
            <TreePlacementWidget
              collectionPath={collectionPath ?? ''}
              documentId={initialData.id as string}
              useAsTitle={useAsTitle}
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
      {showUnsavedModal && <UnsavedChangesModal onClose={() => setShowUnsavedModal(false)} />}
      {pendingSystemFieldsSubmit != null && (
        <SystemFieldsConfirmModal
          contentDirty={pendingSystemFieldsSubmit.contentDirty}
          pathDirty={pendingSystemFieldsSubmit.pathDirty}
          availableLocalesDirty={pendingSystemFieldsSubmit.availableLocalesDirty}
          onCancel={() => setPendingSystemFieldsSubmit(null)}
          onConfirm={() => {
            const payload = pendingSystemFieldsSubmit
            setPendingSystemFieldsSubmit(null)
            submitPayload(payload)
          }}
        />
      )}
      {guard.isBlocked && <NavigationGuardModal onStay={guard.stay} onProceed={guard.proceed} />}
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
  onDeleteLocale,
  contentLocales,
  nextStatus,
  workflowStatuses,
  publishedVersion,
  initialData,
  adminConfig,
  useAsTitle,
  useAsPath,
  advertiseLocales,
  tree,
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
      documentId={mode === 'edit' && typeof initialData?.id === 'string' ? initialData.id : null}
      collectionPath={collectionPath ?? null}
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
        onDeleteLocale={onDeleteLocale}
        contentLocales={contentLocales}
        nextStatus={nextStatus}
        workflowStatuses={workflowStatuses}
        publishedVersion={publishedVersion}
        initialData={initialData}
        adminConfig={adminConfig}
        useAsTitle={useAsTitle}
        useAsPath={useAsPath}
        advertiseLocales={advertiseLocales}
        tree={tree}
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
