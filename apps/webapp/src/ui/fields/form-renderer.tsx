/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'

import type { CollectionAdminConfig, Field, WorkflowStatus } from '@byline/core'
import {
  Button,
  ComboButton,
  Dropdown,
  EllipsisIcon,
  IconButton,
  Modal,
  Select,
  SelectItem,
} from '@infonomic/uikit/react'

import { contentLocales, i18n } from '~/i18n'
import { Tabs } from '../admin/tabs'
import { LocalDateTime } from '../components/local-date-time'
import { FieldRenderer } from '../fields/field-renderer'
import { FormProvider, useFieldValue, useFormContext } from '../fields/form-context'
import { executeUploads } from '../fields/upload-executor'
import { DocumentActions } from './document-actions'

/** Metadata about a previously published version that is still live. */
export interface PublishedVersionInfo {
  document_version_id: string
  document_id: string
  status: string
  created_at: string | Date
  updated_at: string | Date
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
  headingLabel?: string
  headerSlot?: ReactNode
  /** Collection path forwarded to upload-capable fields (e.g. `'media'`). */
  collectionPath?: string
  /** The active content locale — initialised from the route query string. */
  initialLocale?: string
  /** Called when the user picks a different content locale. */
  onLocaleChange?: (locale: string) => void
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

  return (
    <div className="form-status text-sm flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
        <div className="published flex items-center gap-1 min-w-0">
          <span className="muted shrink-0">Status:</span>
          <span className="truncate overflow-hidden">{statusLabel}</span>
        </div>

        {initialData?.updated_at != null && (
          <div className="last-modified flex items-center gap-1 min-w-0">
            <span className="muted shrink-0">Last modified:</span>
            <span className="truncate overflow-hidden">
              <LocalDateTime value={initialData.updated_at} />
            </span>
          </div>
        )}

        {initialData?.created_at != null && (
          <div className="created flex items-center gap-1 min-w-0">
            <span className="muted shrink-0">Created:</span>
            <span className="truncate overflow-hidden">
              <LocalDateTime value={initialData.created_at} />
            </span>
          </div>
        )}
      </div>

      {publishedVersion != null && (
        <div className="published-version-notice inline">
          <span className="muted text-[0.8rem]">
            A published version is currently live.{' '}
            {publishedVersion.updated_at ? (
              <span>
                Published on <LocalDateTime value={publishedVersion.updated_at} />
              </span>
            ) : (
              ''
            )}
          </span>
          {onUnpublish && (
            <>
              {' '}
              <button type="button" onClick={onUnpublish} className="text-[0.8rem] underline">
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
  headingLabel,
  headerSlot,
  collectionPath,
  initialLocale,
  onLocaleChange,
  _activeTab,
  _onTabChange,
}: FormRendererProps & {
  /** Lifted tab state from FormRenderer — preserves the active tab across locale-change remounts. */
  _activeTab?: string
  _onTabChange?: (tab: string) => void
}) => {
  const {
    getFieldValues,
    runFieldHooks,
    validateForm,
    errors: initialErrors,
    hasChanges: hasChangesFn,
    resetHasChanges,
    getPatches,
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
  const [contentLocale, setContentLocale] = useState(initialLocale ?? i18n.content.defaultLocale)

  // Sync contentLocale when the route re-fetches with a different locale.
  useEffect(() => {
    if (initialLocale) setContentLocale(initialLocale)
  }, [initialLocale])

  // Tabs — initialise from lifted parent state (preserves tab across locale-change remounts),
  // falling back to the first declared tab (or empty string when no tabs are configured).
  const tabsConfig = adminConfig?.tabs
  const hasTabs = tabsConfig != null && tabsConfig.length > 0
  const [activeTab, setActiveTab] = useState<string>(
    _activeTab && tabsConfig?.some((t) => t.name === _activeTab)
      ? _activeTab
      : (tabsConfig?.[0]?.name ?? '')
  )

  // Keep parent ref in sync whenever the user manually switches tabs.
  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab)
      _onTabChange?.(tab)
    },
    [_onTabChange]
  )

  // Track live form data so TabDefinition.condition functions can react to field changes
  const [formData, setFormData] = useState<Record<string, any>>(() => getFieldValues())

  // Live document heading — tracks the useAsTitle field as the user types
  const titleFieldName = adminConfig?.useAsTitle
  const liveTitle = useFieldValue<string>(titleFieldName ?? '')
  const heading =
    liveTitle ||
    (headingLabel
      ? `${mode === 'create' ? 'Create' : 'Edit'} ${headingLabel}`
      : mode === 'create'
        ? 'Create'
        : 'Edit')

  // Navigation guard — block TanStack Router navigation and browser unload when dirty
  const shouldBlockFn = useCallback(() => hasChanges, [hasChanges])
  const blocker = useBlocker({
    shouldBlockFn,
    enableBeforeUnload: true,
    withResolver: true,
  })

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
          const uploadResult = await executeUploads(pendingUploads)

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

      if (onSubmit && typeof onSubmit === 'function') {
        onSubmit({ data, patches })
        resetHasChanges()
      }
    })()
  }

  // Compute visible tabs, applying any condition functions against the live form data
  const visibleTabs = useMemo(
    () => tabsConfig?.filter((tab) => !tab.condition || tab.condition(formData)) ?? [],
    [tabsConfig, formData]
  )

  // If the active tab has been hidden by a condition, fall back to the first visible tab
  const resolvedActiveTab =
    hasTabs && visibleTabs.length > 0 && !visibleTabs.some((t) => t.name === activeTab)
      ? (visibleTabs[0]?.name ?? activeTab)
      : activeTab

  // Split fields by tab and position.
  // When tabs are configured, fields with no explicit tab assignment default to the first tab.
  const fieldPositions = adminConfig?.fields ?? {}
  const firstTabName = tabsConfig?.[0]?.name

  // Count errors per tab so the Tabs bar can show a danger badge
  const tabErrorCounts = useMemo<Record<string, number>>(() => {
    if (!hasTabs) return {}
    const counts: Record<string, number> = {}
    for (const err of errors) {
      // err.field is the top-level field name; look up its tab assignment
      const assignedTab = fieldPositions[err.field]?.tab ?? firstTabName
      if (assignedTab) {
        counts[assignedTab] = (counts[assignedTab] ?? 0) + 1
      }
    }
    return counts
  }, [hasTabs, errors, fieldPositions, firstTabName])

  const fieldBelongsToActiveTab = (fieldName: string): boolean => {
    if (!hasTabs) return true
    const assignedTab = fieldPositions[fieldName]?.tab
    const effectiveTab = assignedTab ?? firstTabName
    return effectiveTab === resolvedActiveTab
  }

  const defaultFields = fields.filter((f) => {
    if (!fieldBelongsToActiveTab(f.name)) return false
    const pos = fieldPositions[f.name]?.position
    return pos == null || pos === 'default'
  })
  const sidebarFields = fields.filter((f) => {
    return fieldPositions[f.name]?.position === 'sidebar'
  })

  return (
    <form noValidate onSubmit={handleSubmit} className="w-full flex flex-col">
      <div className="item-view flex flex-col sm:flex-row justify-start sm:justify-between mb-3">
        <h1 className="mb-2">{heading}</h1>
        {headerSlot}
      </div>
      <div className="sticky rounded top-[45px] z-20 p-2 bg-canvas-25 dark:bg-canvas-800 form-status-and-actions mb-3 lg:mb-0 flex flex-col lg:flex-row items-start lg:items-center gap-2 justify-start lg:justify-between border border-gray-800">
        <FormStatusDisplay
          initialData={initialData}
          workflowStatuses={workflowStatuses}
          publishedVersion={publishedVersion}
          onUnpublish={onUnpublish}
        />
        <div className="form-actions flex items-center gap-2">
          <Button
            size="sm"
            intent="noeffect"
            type="button"
            onClick={handleCancel}
            className="min-w-[70px]"
          >
            {hasChanges === false ? 'Close' : 'Cancel'}
          </Button>
          <Button
            size="sm"
            type="submit"
            className="min-w-[70px]"
            disabled={hasChanges === false || isUploading}
          >
            {isUploading ? 'Uploading…' : 'Save'}
          </Button>
          {primaryStatus && onStatusChange && (
            <div className="relative z-10">
              <ComboButton
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
      <div className="page-layout--two-columns--right-sticky pt-8">
        <div className="content flex flex-col gap-4">
          {hasTabs && visibleTabs.length > 0 && (
            <Tabs
              tabs={visibleTabs}
              activeTab={resolvedActiveTab}
              onChange={handleTabChange}
              errorCounts={tabErrorCounts}
              className="-mt-4 mb-0"
            />
          )}
          {defaultFields.map((field) => (
            <FieldRenderer
              key={field.name}
              field={field}
              defaultValue={initialData?.[field.name]}
              collectionPath={collectionPath}
              contentLocale={contentLocale}
            />
          ))}
        </div>
        <div className="sidebar-second mt-0 px-4 pt-1 bg-canvas-50/20 dark:bg-canvas-900 border-l border-gray-100 dark:border-gray-800 flex flex-col gap-4">
          {/* <div className="content-locales relative z-10">
            <h3 className="text-[1rem] font-medium mb-2">Content Language</h3>
            <div className="content-locales-actions flex gap-2">
              <Select
                name="contentLocale"
                id="contentLocale"
                className="min-w-[140px]"
                size="sm"
                variant='outlined'
                value={contentLocale}
                onValueChange={(value) => {
                  setContentLocale(value)
                  onLocaleChange?.(value)
                }}
              >
                {contentLocales.map((locale) => (
                  <SelectItem key={locale.code} value={locale.code}>
                    {locale.label}
                  </SelectItem>
                ))}
              </Select>
              <Dropdown.Root>
                <Dropdown.Trigger asChild>
                  <IconButton variant="text" intent="noeffect" size="sm">
                    <EllipsisIcon className="rotate-90 text-primary-500" width="15px" height="15px" />
                  </IconButton>
                </Dropdown.Trigger>

                <Dropdown.Portal>
                  <Dropdown.Content
                    className="min-w-[110px]"
                    align="end"
                    data-side="top"
                    sideOffset={10}
                  >
                    <Dropdown.Item
                    >
                      <div className="dropdown-item-content flex items-center ml-1">
                        <span className="dropdown-item-content-text text-left text-sm inline-block w-full">
                          Copy to Locale
                        </span>
                      </div>
                    </Dropdown.Item>
                  </Dropdown.Content>
                </Dropdown.Portal>
              </Dropdown.Root>
            </div>
          </div> */}
          {sidebarFields.map((field) => (
            <FieldRenderer
              key={field.name}
              field={field}
              defaultValue={initialData?.[field.name]}
              collectionPath={collectionPath}
              contentLocale={contentLocale}
            />
          ))}
        </div>
      </div>
      {blocker.status === 'blocked' && (
        <Modal isOpen={true} closeOnOverlayClick={false} onDismiss={blocker.reset}>
          <Modal.Container style={{ maxWidth: '460px' }}>
            <Modal.Header className="pt-4 mb-2">
              <h3 className="m-0 mb-2 text-2xl">Leave without saving?</h3>
            </Modal.Header>
            <Modal.Content>
              <p className="text-sm">
                Your changes have not been saved. If you leave now, you will lose your changes.
              </p>
            </Modal.Content>
            <Modal.Actions>
              <Button size="sm" intent="noeffect" type="button" onClick={blocker.reset}>
                Stay on this page
              </Button>
              <Button size="sm" intent="danger" type="button" onClick={blocker.proceed}>
                Leave anyway
              </Button>
            </Modal.Actions>
          </Modal.Container>
        </Modal>
      )}
    </form >
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
  headingLabel,
  headerSlot,
  collectionPath,
  initialLocale,
  onLocaleChange,
}: FormRendererProps) => {
  // Persists the active tab across locale-change remounts of FormContent.
  // useRef so mutations never trigger a re-render of FormRenderer itself.
  const savedTabRef = useRef<string>('')

  return (
    <FormProvider
      key={`${initialLocale ?? 'default'}-${initialData?.document_version_id ?? ''}`}
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
        headingLabel={headingLabel}
        headerSlot={headerSlot}
        collectionPath={collectionPath}
        initialLocale={initialLocale}
        onLocaleChange={onLocaleChange}
        _activeTab={savedTabRef.current}
        _onTabChange={(tab) => { savedTabRef.current = tab }}
      />
    </FormProvider>
  )
}
