/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'

import type { CollectionAdminConfig, Field, WorkflowStatus } from '@byline/core'
import { Button, ComboButton, Modal } from '@infonomic/uikit/react'

import { Tabs } from '../admin/tabs'
import { LocalDateTime } from '../components/local-date-time'
import { FieldRenderer } from '../fields/field-renderer'
import { FormProvider, useFieldValue, useFormContext } from '../fields/form-context'
import { DocumentActions } from './document-actions'

/** Metadata about a previously published version that is still live. */
export interface PublishedVersionInfo {
  document_version_id: string
  document_id: string
  status: string
  created_at: string | Date
  updated_at: string | Date
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
}: {
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
  } = useFormContext()

  const [errors, setErrors] = useState(initialErrors)
  const [hasChanges, setHasChanges] = useState(hasChangesFn())
  const [statusBusy, setStatusBusy] = useState(false)

  // Tabs — initialise active tab to the first declared tab (empty string when no tabs configured)
  const tabsConfig = adminConfig?.tabs
  const hasTabs = tabsConfig != null && tabsConfig.length > 0
  const [activeTab, setActiveTab] = useState<string>(() => tabsConfig?.[0]?.name ?? '')

  // Track live form data so TabDefinition.condition functions can react to field changes
  const [formData, setFormData] = useState<Record<string, any>>(() => getFieldValues())

  // Live document heading — tracks the useAsTitle field as the user types
  const titleFieldName = adminConfig?.useAsTitle
  const liveTitle = useFieldValue<string>(titleFieldName ?? '')
  const heading = liveTitle || (headingLabel ? `Edit ${headingLabel}` : 'Edit')

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
      {/* Will revisit */}
      {/* {errors.length > 0 && (
        <div className="mb-4 p-3 bg-canvas-25 dark:bg-canvas-800 border border-red-700 rounded">
          <h4 className="text-red-800 font-medium">Please fix the following errors:</h4>
          <ul className="mt-2 text-sm text-red-700">
            {errors.map((error, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: index is okay here.
              <li key={index}>• {error.message}</li>
            ))}
          </ul>
        </div>
      )} */}

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
          <Button size="sm" type="submit" className="min-w-[70px]" disabled={hasChanges === false}>
            Save
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
              onChange={setActiveTab}
              errorCounts={tabErrorCounts}
              className="-mt-4 mb-0"
            />
          )}
          {defaultFields.map((field) => (
            <FieldRenderer
              key={field.name}
              field={field}
              defaultValue={initialData?.[field.name]}
            />
          ))}
        </div>
        <div className="sidebar-second mt-0 px-4 pt-1 bg-canvas-50/20 dark:bg-canvas-900 border-l border-gray-100 dark:border-gray-800 flex flex-col gap-4">
          {sidebarFields.map((field) => (
            <FieldRenderer
              key={field.name}
              field={field}
              defaultValue={initialData?.[field.name]}
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
    </form>
  )
}

export const FormRenderer = ({
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
}: {
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
}) => (
  <FormProvider initialData={initialData}>
    <FormContent
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
    />
  </FormProvider>
)
