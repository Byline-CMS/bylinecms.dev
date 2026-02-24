/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

import type { Field, FieldBeforeChangeResult, FieldHookContext } from '@byline/core'
import { normalizeHooks } from '@byline/core'
import type { DocumentPatch, FieldSetPatch } from '@byline/core/patches'
import { get as getNestedValue, set as setNestedValue } from 'lodash-es'

interface FormError {
  field: string
  message: string
}

/**
 * Represents a file that has been selected but not yet uploaded.
 * The file is held locally until form submission.
 */
export interface PendingUpload {
  /** The actual File object to upload */
  file: File
  /** Blob URL for local preview (must be revoked on cleanup) */
  previewUrl: string
  /** The collection path for the upload endpoint */
  collectionPath: string
}

type FieldListener = (value: any) => void
type ErrorsListener = (errors: FormError[]) => void
type MetaListener = () => void

interface FormContextType {
  setFieldValue: (name: string, value: any) => void
  setFieldStore: (name: string, value: any) => void
  getFieldValue: (name: string) => any
  getFieldValues: () => Record<string, any>
  getPatches: () => DocumentPatch[]
  appendPatch: (patch: DocumentPatch) => void
  resetPatches: () => void
  hasChanges: () => boolean
  resetHasChanges: () => void
  runFieldHooks: (fields: Field[]) => Promise<FormError[]>
  validateForm: (fields: Field[]) => FormError[]
  errors: FormError[]
  clearErrors: () => void
  setFieldError: (field: string, message: string) => void
  clearFieldError: (field: string) => void
  isDirty: (fieldName: string) => boolean
  subscribeField: (name: string, listener: FieldListener) => () => void
  subscribeErrors: (listener: ErrorsListener) => () => void
  subscribeMeta: (listener: MetaListener) => () => void
  // Pending uploads (deferred until save)
  addPendingUpload: (fieldPath: string, upload: PendingUpload) => void
  removePendingUpload: (fieldPath: string) => void
  getPendingUploads: () => Map<string, PendingUpload>
  hasPendingUploads: () => boolean
  clearPendingUploads: () => void
}

const FormContext = createContext<FormContextType | null>(null)

export const useFormContext = () => {
  const context = useContext(FormContext)
  if (context == null) {
    throw new Error('useFormContext must be used within a FormProvider')
  }
  return context
}

export const FormProvider = ({
  children,
  initialData = {},
}: {
  children: React.ReactNode
  initialData?: Record<string, any>
}) => {
  const fieldValues = useRef<Record<string, any>>(JSON.parse(JSON.stringify(initialData)))
  const initialValues = useRef<Record<string, any>>(initialData)
  const errorsRef = useRef<FormError[]>([])
  const dirtyFields = useRef<Set<string>>(new Set())
  const patchesRef = useRef<DocumentPatch[]>([])
  const pendingUploadsRef = useRef<Map<string, PendingUpload>>(new Map())

  const fieldListeners = useRef<Map<string, Set<FieldListener>>>(new Map())
  const errorListeners = useRef<Set<ErrorsListener>>(new Set())
  const metaListeners = useRef<Set<MetaListener>>(new Set())

  const subscribeField = useCallback((name: string, listener: FieldListener) => {
    if (!fieldListeners.current.has(name)) {
      fieldListeners.current.set(name, new Set())
    }
    fieldListeners.current.get(name)?.add(listener)
    return () => {
      const listeners = fieldListeners.current.get(name)
      if (listeners) {
        listeners.delete(listener)
        if (listeners.size === 0) {
          fieldListeners.current.delete(name)
        }
      }
    }
  }, [])

  const subscribeErrors = useCallback((listener: ErrorsListener) => {
    errorListeners.current.add(listener)
    return () => {
      errorListeners.current.delete(listener)
    }
  }, [])

  const subscribeMeta = useCallback((listener: MetaListener) => {
    metaListeners.current.add(listener)
    return () => {
      metaListeners.current.delete(listener)
    }
  }, [])

  const notifyFieldListeners = useCallback((name: string, value: any) => {
    const listeners = fieldListeners.current.get(name)
    if (listeners) {
      listeners.forEach((listener) => {
        listener(value)
      })
    }
  }, [])

  const notifyErrorListeners = useCallback(() => {
    errorListeners.current.forEach((listener) => {
      listener(errorsRef.current)
    })
  }, [])

  const notifyMetaListeners = useCallback(() => {
    metaListeners.current.forEach((listener) => {
      listener()
    })
  }, [])

  const updateFieldStoreInternal = useCallback(
    (name: string, value: any) => {
      const newFieldValues = { ...fieldValues.current }

      // Keep nested path values up to date for generic usage and patches.
      setNestedValue(newFieldValues, name, value)

      // Generic handling for block fields:
      // If the path traverses a block object (identified by { type: 'block', name: '...' }),
      // and the path segment matches the block name, we must also update the internal `fields` array.
      // This ensures that the structured data (used for persistence) stays in sync with the
      // "virtual" path used by the UI (e.g. content[0].richTextBlock[0].richText).

      // We walk the path segments against the object tree.
      // Path format: "content[0].richTextBlock[0].richText"
      // Segments: ["content", "0", "richTextBlock", "0", "richText"]
      // (Note: lodash/set handles the parsing implicitly, but we need to do it explicitly here to find blocks)

      // Simple path parser that handles dot notation and brackets
      const segments = name.replace(/\]/g, '').split(/[.[]/)

      let current = newFieldValues
      for (let i = 0; i < segments.length; i++) {
        const key = segments[i]

        // Check if current object is a block and the key matches its name
        if (
          current &&
          typeof current === 'object' &&
          current.type === 'block' &&
          current.name === key
        ) {
          // We found a block traversal!
          // The path continues into the block's virtual structure.
          // We need to apply the update to the `fields` array instead.

          // The remaining segments describe the path INSIDE the block's fields.
          // e.g. if path was "content[0].richTextBlock[0].richText",
          // we are at "richTextBlock". Remaining: ["0", "richText"].
          // This maps to `fields[0].richText`.

          const remainingSegments = segments.slice(i + 1)
          if (remainingSegments.length > 0) {
            // We need to update `current.fields` at `remainingSegments`.
            // Since `current` is a reference to the object in the tree, modifying it works.
            // However, for React/Immutability, we should ideally clone.
            // But `setNestedValue` above already mutated the tree structure (or cloned parts of it).
            // Since `newFieldValues` is a shallow copy of root, and `setNestedValue` handles deep cloning/mutation,
            // we can assume `current` is the object we want to modify.

            // Ensure fields array exists
            if (!Array.isArray(current.fields)) {
              current.fields = []
            }

            // Use setNestedValue to update the fields array
            // We construct a path string for the remaining part
            // e.g. "0.richText" -> "fields[0].richText"
            // But `setNestedValue` takes an object and a path.
            // We can just call it on `current` with path `fields.${remainingPath}`

            // Reconstruct path from segments (handling array indices)
            // Actually, `setNestedValue` supports array path.
            const fieldsPath = ['fields', ...remainingSegments]
            setNestedValue(current, fieldsPath, value)
          }

          // We don't need to continue traversing down the "virtual" path because
          // we've handled the sync to "fields".
          // (The virtual path update was already done by the first setNestedValue call at the top)
          break
        }

        // Move to next level
        if (current && typeof current === 'object' && key in current) {
          current = current[key]
        } else {
          // Path doesn't exist in the tree (or we hit a leaf), stop.
          break
        }
      }

      fieldValues.current = newFieldValues
      dirtyFields.current.add(name)

      notifyFieldListeners(name, value)
      notifyMetaListeners()
    },
    [notifyFieldListeners, notifyMetaListeners]
  )

  const setFieldStore = useCallback(
    (name: string, value: any) => {
      updateFieldStoreInternal(name, value)
    },
    [updateFieldStoreInternal]
  )

  const setFieldValue = useCallback(
    (name: string, value: any) => {
      updateFieldStoreInternal(name, value)

      const patch: FieldSetPatch = {
        kind: 'field.set',
        path: name,
        value,
      }

      // Optimization: Coalesce consecutive field.set patches for the same path
      const lastPatch = patchesRef.current[patchesRef.current.length - 1]
      if (lastPatch && lastPatch.kind === 'field.set' && lastPatch.path === name) {
        const newPatches = [...patchesRef.current]
        newPatches[newPatches.length - 1] = patch
        patchesRef.current = newPatches
      } else {
        patchesRef.current = [...patchesRef.current, patch]
      }

      // Clear field-specific errors when value changes
      if (errorsRef.current.some((error) => error.field === name)) {
        errorsRef.current = errorsRef.current.filter((error) => error.field !== name)
        notifyErrorListeners()
      }
      console.log('Current patch list:', patchesRef.current)
    },
    [updateFieldStoreInternal, notifyErrorListeners]
  )

  const getFieldValues = useCallback(() => fieldValues.current, [])

  const getPatches = useCallback(() => patchesRef.current, [])
  const appendPatch = useCallback(
    (patch: DocumentPatch) => {
      patchesRef.current = [...patchesRef.current, patch]
      // Mark a generic dirty flag so hasChanges() becomes true even
      // for patches that don't correspond to a specific field.set.
      dirtyFields.current.add('__patch__')
      notifyMetaListeners()
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.debug('FormContext.appendPatch', { patch, dirtyCount: dirtyFields.current.size })
      }
    },
    [notifyMetaListeners]
  )

  const getFieldValue = useCallback((name: string) => {
    const dirty = dirtyFields.current.has(name)
    const currentValue = getNestedValue(fieldValues.current, name)

    if (currentValue !== undefined) {
      return currentValue
    }
    if (!dirty) {
      return getNestedValue(initialValues.current, name)
    }
    return undefined
  }, [])

  const hasChanges = useCallback(() => {
    return dirtyFields.current.size > 0
  }, [])

  const resetHasChanges = useCallback(() => {
    dirtyFields.current.clear()
    patchesRef.current = []
    notifyMetaListeners()
  }, [notifyMetaListeners])

  const isDirty = useCallback((fieldName: string) => {
    return dirtyFields.current.has(fieldName)
  }, [])

  // ---------------------------------------------------------------------------
  // Pending uploads (deferred until save)
  // ---------------------------------------------------------------------------

  const addPendingUpload = useCallback(
    (fieldPath: string, upload: PendingUpload) => {
      // If there's an existing pending upload for this path, revoke its blob URL
      const existing = pendingUploadsRef.current.get(fieldPath)
      if (existing) {
        URL.revokeObjectURL(existing.previewUrl)
      }
      pendingUploadsRef.current.set(fieldPath, upload)
      dirtyFields.current.add(fieldPath)
      notifyMetaListeners()
    },
    [notifyMetaListeners]
  )

  const removePendingUpload = useCallback(
    (fieldPath: string) => {
      const existing = pendingUploadsRef.current.get(fieldPath)
      if (existing) {
        URL.revokeObjectURL(existing.previewUrl)
        pendingUploadsRef.current.delete(fieldPath)
        notifyMetaListeners()
      }
    },
    [notifyMetaListeners]
  )

  const getPendingUploads = useCallback(() => {
    return new Map(pendingUploadsRef.current)
  }, [])

  const hasPendingUploads = useCallback(() => {
    return pendingUploadsRef.current.size > 0
  }, [])

  const clearPendingUploads = useCallback(() => {
    // Revoke all blob URLs to prevent memory leaks
    for (const upload of pendingUploadsRef.current.values()) {
      URL.revokeObjectURL(upload.previewUrl)
    }
    pendingUploadsRef.current.clear()
  }, [])

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      for (const upload of pendingUploadsRef.current.values()) {
        URL.revokeObjectURL(upload.previewUrl)
      }
    }
  }, [])

  const validateForm = useCallback(
    (fields: Field[]): FormError[] => {
      const formErrors: FormError[] = []

      // This validation logic might need to be enhanced to handle nested fields.
      // For now, it will validate top-level fields.
      for (const field of fields) {
        const value = getFieldValue(field.name)

        // Required field validation
        if (field.required && (value == null || value === '')) {
          formErrors.push({
            field: field.name,
            message: `${field.label} is required`,
          })
        }

        // Type-specific validation
        if (value != null && value !== '') {
          switch (field.type) {
            case 'text':
              if (typeof value !== 'string') {
                formErrors.push({
                  field: field.name,
                  message: `${field.label} must be text`,
                })
              }
              break
            case 'checkbox':
              if (typeof value !== 'boolean') {
                formErrors.push({
                  field: field.name,
                  message: `${field.label} must be true or false`,
                })
              }
              break
            case 'select':
              if ('options' in field && field.options) {
                const validValues = field.options.map((opt) => opt.value)
                if (!validValues.includes(value)) {
                  formErrors.push({
                    field: field.name,
                    message: `${field.label} must be one of: ${validValues.join(', ')}`,
                  })
                }
              }
              break
            case 'datetime':
              if (value instanceof Date === false && typeof value !== 'string') {
                formErrors.push({
                  field: field.name,
                  message: `${field.label} must be a valid date`,
                })
              }
              break
          }
        }
      }

      errorsRef.current = formErrors
      notifyErrorListeners()
      return formErrors
    },
    [getFieldValue, notifyErrorListeners]
  )

  const clearErrors = useCallback(() => {
    errorsRef.current = []
    notifyErrorListeners()
  }, [notifyErrorListeners])

  const setFieldError = useCallback(
    (field: string, message: string) => {
      // Replace any existing error for this field, or add a new one
      const filtered = errorsRef.current.filter((e) => e.field !== field)
      filtered.push({ field, message })
      errorsRef.current = filtered
      notifyErrorListeners()
    },
    [notifyErrorListeners]
  )

  const clearFieldError = useCallback(
    (field: string) => {
      if (errorsRef.current.some((e) => e.field === field)) {
        errorsRef.current = errorsRef.current.filter((e) => e.field !== field)
        notifyErrorListeners()
      }
    },
    [notifyErrorListeners]
  )

  /**
   * Run `beforeValidate` hooks for every top-level field that defines one.
   * Called at submit time, before `validateForm()`. Hooks may return
   * `{ value }` to auto-populate a field, or `{ error }` to block submit.
   */
  const runFieldHooks = useCallback(
    async (fields: Field[]): Promise<FormError[]> => {
      const hookErrors: FormError[] = []
      const data = { ...fieldValues.current }

      for (const field of fields) {
        const fns = normalizeHooks(field.hooks?.beforeValidate)
        if (fns.length === 0) continue

        const path = field.name
        const value = getFieldValue(path)

        const ctx: FieldHookContext = {
          value,
          previousValue: value,
          data,
          path,
          field,
          operation: 'submit',
        }

        try {
          for (const fn of fns) {
            const result = (await fn(ctx)) as FieldBeforeChangeResult | undefined
            if (result?.error) {
              hookErrors.push({ field: path, message: result.error })
            }
            if (result?.value !== undefined) {
              // Auto-populate: write the derived value into the store
              setFieldValue(path, result.value)
              // Keep ctx and data snapshot in sync for subsequent hooks
              ctx.value = result.value
              data[path] = result.value
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unexpected hook error'
          hookErrors.push({ field: path, message })
        }
      }

      if (hookErrors.length > 0) {
        errorsRef.current = [...errorsRef.current, ...hookErrors]
        notifyErrorListeners()
      }

      return hookErrors
    },
    [getFieldValue, setFieldValue, notifyErrorListeners]
  )

  return (
    <FormContext.Provider
      value={{
        setFieldValue,
        setFieldStore,
        getFieldValue,
        getFieldValues,
        getPatches,
        appendPatch,
        resetPatches: () => {
          patchesRef.current = []
        },
        hasChanges,
        resetHasChanges,
        runFieldHooks,
        validateForm,
        errors: errorsRef.current,
        clearErrors,
        setFieldError,
        clearFieldError,
        isDirty,
        subscribeField,
        subscribeErrors,
        subscribeMeta,
        addPendingUpload,
        removePendingUpload,
        getPendingUploads,
        hasPendingUploads,
        clearPendingUploads,
      }}
    >
      {children}
    </FormContext.Provider>
  )
}

export const useFormStore = () => {
  return useFormContext()
}

export const useFieldError = (name: string) => {
  const { errors, subscribeErrors } = useFormContext()
  const [error, setError] = useState<string | undefined>(
    errors.find((e) => e.field === name)?.message
  )

  useEffect(() => {
    const unsubscribe = subscribeErrors((currentErrors) => {
      const fieldError = currentErrors.find((e) => e.field === name)
      setError(fieldError?.message)
    })
    return unsubscribe
  }, [subscribeErrors, name])

  return error
}

export const useFormMeta = () => {
  const { hasChanges, subscribeMeta } = useFormContext()
  const [hasChangesValue, setHasChangesValue] = useState(hasChanges())

  useEffect(() => {
    const unsubscribe = subscribeMeta(() => {
      setHasChangesValue(hasChanges())
    })
    return unsubscribe
  }, [subscribeMeta, hasChanges])

  return {
    hasChanges: hasChangesValue,
  }
}

export const useIsDirty = (name: string) => {
  const { isDirty, subscribeMeta } = useFormContext()
  const [dirty, setDirty] = useState(isDirty(name))

  useEffect(() => {
    const unsubscribe = subscribeMeta(() => {
      setDirty(isDirty(name))
    })
    return unsubscribe
  }, [subscribeMeta, isDirty, name])

  return dirty
}

export const useFieldValue = <T = any>(name: string): T | undefined => {
  const { getFieldValue, subscribeField } = useFormContext()
  const [value, setValue] = useState<T | undefined>(() => getFieldValue(name))

  useEffect(() => {
    const unsubscribe = subscribeField(name, (nextValue) => {
      setValue(nextValue)
    })
    return unsubscribe
  }, [subscribeField, name])

  return value
}
