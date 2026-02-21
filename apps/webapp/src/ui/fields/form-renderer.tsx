/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'

import type { CollectionAdminConfig, Field, WorkflowStatus } from '@byline/core'
import { Button, ComboButton } from '@infonomic/uikit/react'

import { LocalDateTime } from '../components/local-date-time'
import { FieldRenderer } from '../fields/field-renderer'
import { FormProvider, useFormContext } from '../fields/form-context'

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
    <div className="form-status text-sm flex flex-col gap-1">
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
        <div className="published-version-notice flex items-center gap-2 text-xs">
          <span className="text-green-600 dark:text-green-500">
            A published version is currently live. {' '}
            {publishedVersion.updated_at
              ? (<span>Published on <LocalDateTime value={publishedVersion.updated_at} /></span>)
              : ''
            }
          </span>
          {onUnpublish && (
            <button
              type="button"
              onClick={onUnpublish}
              className="text-xs underline text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
            >
              Unpublish
            </button>
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
  nextStatus,
  workflowStatuses,
  publishedVersion,
  initialData,
  adminConfig,
}: {
  fields: Field[]
  onSubmit: (data: any) => void
  onCancel: () => void
  onStatusChange?: (nextStatus: string) => Promise<void>
  onUnpublish?: () => Promise<void>
  nextStatus?: WorkflowStatus
  workflowStatuses?: WorkflowStatus[]
  publishedVersion?: PublishedVersionInfo | null
  initialData?: Record<string, any>
  adminConfig?: CollectionAdminConfig
}) => {
  const {
    getFieldValues,
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

  const handleCancel = () => {
    if (onCancel && typeof onCancel === 'function') {
      onCancel()
    }
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    // Validate form
    const formErrors = validateForm(fields)
    if (formErrors.length > 0) {
      console.error('Form validation failed:', formErrors)
      return
    }

    const data = getFieldValues()
    const patches = getPatches()

    if (onSubmit && typeof onSubmit === 'function') {
      onSubmit({ data, patches })
      resetHasChanges()
    }
  }

  // Split fields by admin config position
  const fieldPositions = adminConfig?.fields ?? {}
  const defaultFields = fields.filter((f) => {
    const pos = fieldPositions[f.name]?.position
    return pos == null || pos === 'default'
  })
  const sidebarFields = fields.filter((f) => fieldPositions[f.name]?.position === 'sidebar')

  return (
    <form onSubmit={handleSubmit} className="w-full flex flex-col">
      {errors.length > 0 && (
        <div className="mb-4 p-3 bg-canvas-25 dark:bg-canvas-800 border border-red-700 rounded">
          <h4 className="text-red-800 font-medium">Please fix the following errors:</h4>
          <ul className="mt-2 text-sm text-red-700">
            {errors.map((error, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: index is okay here.
              <li key={index}>• {error.message}</li>
            ))}
          </ul>
        </div>
      )}

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
                {statusBusy ? '...' : (primaryStatus.verb ?? primaryStatus.label ?? primaryStatus.name)}
              </ComboButton>
            </div>
          )}
        </div>
      </div>
      <div className="page-layout--two-columns--right-sticky pt-4">
        <div className="content flex flex-col gap-4">
          {defaultFields.map((field) => (
            <FieldRenderer
              key={field.name}
              field={field}
              defaultValue={initialData?.[field.name]}
            />
          ))}
        </div>
        <div className="sidebar-second mt-4 p-4 bg-canvas-50/20 dark:bg-canvas-900 border-l border-gray-100 dark:border-gray-800 flex flex-col gap-4">
          {sidebarFields.map((field) => (
            <FieldRenderer
              key={field.name}
              field={field}
              defaultValue={initialData?.[field.name]}
            />
          ))}
        </div>
      </div>
    </form>
  )
}

export const FormRenderer = ({
  fields,
  onSubmit,
  onCancel,
  onStatusChange,
  onUnpublish,
  nextStatus,
  workflowStatuses,
  publishedVersion,
  initialData,
  adminConfig,
}: {
  fields: Field[]
  onSubmit: (data: any) => void
  onCancel: () => void
  onStatusChange?: (nextStatus: string) => Promise<void>
  onUnpublish?: () => Promise<void>
  nextStatus?: WorkflowStatus
  workflowStatuses?: WorkflowStatus[]
  publishedVersion?: PublishedVersionInfo | null
  initialData?: Record<string, any>
  adminConfig?: CollectionAdminConfig
}) => (
  <FormProvider initialData={initialData}>
    <FormContent
      fields={fields}
      onSubmit={onSubmit}
      onCancel={onCancel}
      onStatusChange={onStatusChange}
      onUnpublish={onUnpublish}
      nextStatus={nextStatus}
      workflowStatuses={workflowStatuses}
      publishedVersion={publishedVersion}
      initialData={initialData}
      adminConfig={adminConfig}
    />
  </FormProvider>
)
