/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// NOTE: Before you dunk on this, this is a totally naïve  and "weekend hack"
// implementation of a form renderer used only for prototype development.

import { useEffect, useState } from 'react'

import type { CollectionAdminConfig, Field } from '@byline/core'
import { Button } from '@infonomic/uikit/react'

import { formatDateTime } from '../../utils/utils.general'
import { FieldRenderer } from '../fields/field-renderer'
import { FormProvider, useFormContext } from '../fields/form-context'

const FormStatusDisplay = ({ initialData }: { initialData?: Record<string, any> }) => (
  <div className="form-status text-sm flex flex-col sm:flex-row sm:items-center sm:gap-2">
    <div className="published flex items-center gap-1 min-w-0">
      <span className="muted shrink-0">Status:</span>
      <span className="truncate overflow-hidden">
        {initialData?.status === 'published' ? 'Published' : 'Unpublished'}
      </span>
    </div>

    {initialData?.updated_at != null && (
      <div className="last-modified flex items-center gap-1 min-w-0">
        <span className="muted shrink-0">Last modified:</span>
        <span className="truncate overflow-hidden">{formatDateTime(initialData?.updated_at)}</span>
      </div>
    )}

    {initialData?.created_at != null && (
      <div className="created flex items-center gap-1 min-w-0">
        <span className="muted shrink-0">Created:</span>
        <span className="truncate overflow-hidden">{formatDateTime(initialData?.created_at)}</span>
      </div>
    )}
  </div>
)

const FormContent = ({
  fields,
  onSubmit,
  onCancel,
  initialData,
  adminConfig,
}: {
  fields: Field[]
  onSubmit: (data: any) => void
  onCancel: () => void
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
  const defaultFields = fields.filter(
    (f) => {
      const pos = fieldPositions[f.name]?.position
      return pos == null || pos === 'default'
    }
  )
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

      <div className="sticky rounded top-[45px] z-50 p-2 bg-canvas-25 dark:bg-canvas-800 form-status-and-actions mb-3 lg:mb-0 flex flex-col lg:flex-row items-start lg:items-center gap-2 justify-start lg:justify-between border border-gray-800">
        <FormStatusDisplay initialData={initialData} />
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
          <Button size="sm" type="submit" intent="success" className="min-w-[80px]">
            {initialData?.published === true ? 'Unpublish' : 'Publish'}
          </Button>
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
  initialData,
  adminConfig,
}: {
  fields: Field[]
  onSubmit: (data: any) => void
  onCancel: () => void
  initialData?: Record<string, any>
  adminConfig?: CollectionAdminConfig
}) => (
  <FormProvider initialData={initialData}>
    <FormContent
      fields={fields}
      onSubmit={onSubmit}
      onCancel={onCancel}
      initialData={initialData}
      adminConfig={adminConfig}
    />
  </FormProvider>
)
