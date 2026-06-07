'use client'

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

// Vendored nested get/set (see ./nested-path) — removes the lodash-es dep
// outright. A bare `from 'lodash-es'` import otherwise pools into a single
// ~85KB chunk that leaks onto the public frontend bundle (form-context is
// reachable from the layout graph).
import { get as getNestedValue, set as setNestedValue } from './nested-path'

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
type SystemPathListener = (value: string | null) => void
type SystemAvailableLocalesListener = (value: string[]) => void
type FieldUploadingListener = (uploading: boolean) => void

/**
 * Order-insensitive set equality for the advertised-locale slot. The slot
 * holds an array, so a fresh array reference is never `===` its initial — dirty
 * tracking must compare membership, not identity.
 */
const sameLocaleSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}

/**
 * Why the form is dirty, partitioned by write semantics — drives the single
 * Save button. `content` mints a new version (normal workflow). `direct-write`
 * is an immediate, non-versioned write of the document-grain system fields
 * (path / advertised locales) that does NOT reset workflow status. `both` does
 * each through its own write path. See docs/I18N.md.
 */
export type DirtyReason = 'none' | 'content' | 'direct-write' | 'both'

export interface DirtyBreakdown {
  reason: DirtyReason
  /** Document field data / patches changed → versioned write. */
  contentDirty: boolean
  /** Path widget changed → non-versioned direct write. */
  pathDirty: boolean
  /** Available-locales widget changed → non-versioned direct write. */
  availableLocalesDirty: boolean
}

/** Dirty-tracking keys for the two system-managed, document-grain slots. */
const SYSTEM_PATH_DIRTY_KEY = '__systemPath__'
const SYSTEM_AVAILABLE_LOCALES_DIRTY_KEY = '__systemAvailableLocales__'

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
  getErrors: () => FormError[]
  clearErrors: () => void
  setFieldError: (field: string, message: string) => void
  clearFieldError: (field: string) => void
  isDirty: (fieldName: string) => boolean
  /**
   * Partition the current dirty state into content vs. system-field (path /
   * advertised-locales) writes so the Save button can branch. See
   * docs/I18N.md.
   */
  getDirtyBreakdown: () => DirtyBreakdown
  subscribeField: (name: string, listener: FieldListener) => () => void
  subscribeErrors: (listener: ErrorsListener) => () => void
  subscribeMeta: (listener: MetaListener) => () => void
  // Pending uploads (deferred until save)
  addPendingUpload: (fieldPath: string, upload: PendingUpload) => void
  removePendingUpload: (fieldPath: string) => void
  getPendingUploads: () => Map<string, PendingUpload>
  hasPendingUploads: () => boolean
  clearPendingUploads: () => void
  // Per-field upload-in-flight tracking. Mirrors the pending-uploads map but
  // for the window during which the upload-executor is actively transporting
  // a given fieldPath, so widgets can render a localised spinner/overlay.
  setFieldUploading: (fieldPath: string, uploading: boolean) => void
  getIsFieldUploading: (fieldPath: string) => boolean
  subscribeFieldUploading: (fieldPath: string, listener: FieldUploadingListener) => () => void
  // System-managed `path` slot (persisted in `byline_document_paths`),
  // edited by the path widget. `null` means the widget will fall back
  // to live-derived preview / the server-side default; a non-null value
  // is sent verbatim to the server.
  getSystemPath: () => string | null
  setSystemPath: (value: string | null) => void
  subscribeSystemPath: (listener: SystemPathListener) => () => void
  // System-managed `availableLocales` slot (the editorial advertised-locale
  // set, persisted in `byline_document_available_locales`), edited by the
  // available-locales widget. Holds the full set; the value is sent verbatim
  // to the server. Document-grain and sticky, like the path slot above.
  getSystemAvailableLocales: () => string[]
  setSystemAvailableLocales: (value: string[]) => void
  subscribeSystemAvailableLocales: (listener: SystemAvailableLocalesListener) => () => void
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
  const fieldValues = useRef<Record<string, any>>(
    JSON.parse(JSON.stringify(initialData?.fields ?? initialData))
  )
  const initialValues = useRef<Record<string, any>>(initialData?.fields ?? initialData)
  const errorsRef = useRef<FormError[]>([])
  const dirtyFields = useRef<Set<string>>(new Set())
  const patchesRef = useRef<DocumentPatch[]>([])
  const pendingUploadsRef = useRef<Map<string, PendingUpload>>(new Map())
  const uploadingFieldsRef = useRef<Set<string>>(new Set())
  const uploadingListenersRef = useRef<Map<string, Set<FieldUploadingListener>>>(new Map())

  const fieldListeners = useRef<Map<string, Set<FieldListener>>>(new Map())
  const errorListeners = useRef<Set<ErrorsListener>>(new Set())
  const metaListeners = useRef<Set<MetaListener>>(new Set())

  // System path slot — initialised from the loaded version's top-level
  // `path` (edit mode) or `null` (create mode). Edits via `setSystemPath`
  // mark the form dirty so the Save button enables.
  const systemPathRef = useRef<string | null>(
    typeof initialData?.path === 'string' && (initialData.path as string).length > 0
      ? (initialData.path as string)
      : null
  )
  const initialSystemPath = useRef<string | null>(systemPathRef.current)
  const systemPathListeners = useRef<Set<SystemPathListener>>(new Set())

  // System available-locales slot — initialised from the loaded version's
  // top-level `availableLocales` (edit mode) or `[]` (create mode / not yet
  // surfaced). Edits via `setSystemAvailableLocales` mark the form dirty so
  // the Save button enables. Stored as a defensive copy.
  const systemAvailableLocalesRef = useRef<string[]>(
    Array.isArray(initialData?.availableLocales) ? [...initialData.availableLocales] : []
  )
  const initialSystemAvailableLocales = useRef<string[]>([...systemAvailableLocalesRef.current])
  const systemAvailableLocalesListeners = useRef<Set<SystemAvailableLocalesListener>>(new Set())

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
    initialSystemPath.current = systemPathRef.current
    initialSystemAvailableLocales.current = [...systemAvailableLocalesRef.current]
    notifyMetaListeners()
  }, [notifyMetaListeners])

  const isDirty = useCallback((fieldName: string) => {
    return dirtyFields.current.has(fieldName)
  }, [])

  // Partition the current dirty set by write semantics so the single Save
  // button can route each piece correctly: content → versioned write; the
  // document-grain system fields (path / advertised locales) → immediate,
  // non-versioned direct write that leaves workflow status untouched.
  // See docs/I18N.md.
  const getDirtyBreakdown = useCallback((): DirtyBreakdown => {
    const keys = dirtyFields.current
    const pathDirty = keys.has(SYSTEM_PATH_DIRTY_KEY)
    const availableLocalesDirty = keys.has(SYSTEM_AVAILABLE_LOCALES_DIRTY_KEY)
    let contentDirty = false
    for (const key of keys) {
      if (key !== SYSTEM_PATH_DIRTY_KEY && key !== SYSTEM_AVAILABLE_LOCALES_DIRTY_KEY) {
        contentDirty = true
        break
      }
    }
    const directWrite = pathDirty || availableLocalesDirty
    const reason: DirtyReason =
      contentDirty && directWrite
        ? 'both'
        : contentDirty
          ? 'content'
          : directWrite
            ? 'direct-write'
            : 'none'
    return { reason, contentDirty, pathDirty, availableLocalesDirty }
  }, [])

  // -------------------------------------------------------------------------
  // System path slot
  // -------------------------------------------------------------------------

  const getSystemPath = useCallback(() => systemPathRef.current, [])

  const setSystemPath = useCallback(
    (value: string | null) => {
      systemPathRef.current = value
      if (value !== initialSystemPath.current) {
        dirtyFields.current.add(SYSTEM_PATH_DIRTY_KEY)
      } else {
        dirtyFields.current.delete(SYSTEM_PATH_DIRTY_KEY)
      }
      systemPathListeners.current.forEach((listener) => {
        listener(value)
      })
      notifyMetaListeners()
    },
    [notifyMetaListeners]
  )

  const subscribeSystemPath = useCallback((listener: SystemPathListener) => {
    systemPathListeners.current.add(listener)
    return () => {
      systemPathListeners.current.delete(listener)
    }
  }, [])

  // -------------------------------------------------------------------------
  // System available-locales slot
  // -------------------------------------------------------------------------

  const getSystemAvailableLocales = useCallback(() => systemAvailableLocalesRef.current, [])

  const setSystemAvailableLocales = useCallback(
    (value: string[]) => {
      const next = [...value]
      systemAvailableLocalesRef.current = next
      if (!sameLocaleSet(next, initialSystemAvailableLocales.current)) {
        dirtyFields.current.add(SYSTEM_AVAILABLE_LOCALES_DIRTY_KEY)
      } else {
        dirtyFields.current.delete(SYSTEM_AVAILABLE_LOCALES_DIRTY_KEY)
      }
      systemAvailableLocalesListeners.current.forEach((listener) => {
        listener(next)
      })
      notifyMetaListeners()
    },
    [notifyMetaListeners]
  )

  const subscribeSystemAvailableLocales = useCallback(
    (listener: SystemAvailableLocalesListener) => {
      systemAvailableLocalesListeners.current.add(listener)
      return () => {
        systemAvailableLocalesListeners.current.delete(listener)
      }
    },
    []
  )

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

  // ---------------------------------------------------------------------------
  // Per-field upload-in-flight tracking
  // ---------------------------------------------------------------------------

  const setFieldUploading = useCallback((fieldPath: string, uploading: boolean) => {
    if (uploading) {
      if (uploadingFieldsRef.current.has(fieldPath)) return
      uploadingFieldsRef.current.add(fieldPath)
    } else {
      if (!uploadingFieldsRef.current.has(fieldPath)) return
      uploadingFieldsRef.current.delete(fieldPath)
    }
    uploadingListenersRef.current.get(fieldPath)?.forEach((listener) => {
      listener(uploading)
    })
  }, [])

  const getIsFieldUploading = useCallback((fieldPath: string) => {
    return uploadingFieldsRef.current.has(fieldPath)
  }, [])

  const subscribeFieldUploading = useCallback(
    (fieldPath: string, listener: FieldUploadingListener) => {
      let listeners = uploadingListenersRef.current.get(fieldPath)
      if (!listeners) {
        listeners = new Set()
        uploadingListenersRef.current.set(fieldPath, listeners)
      }
      listeners.add(listener)
      return () => {
        const set = uploadingListenersRef.current.get(fieldPath)
        if (set) {
          set.delete(listener)
          if (set.size === 0) {
            uploadingListenersRef.current.delete(fieldPath)
          }
        }
      }
    },
    []
  )

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
      const data = getFieldValues()

      for (const field of fields) {
        const value = getFieldValue(field.name)

        // Required field validation
        if (!field.optional && (value == null || value === '')) {
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

        // Custom validate function — applies to all field types including structure fields.
        if (field.validate) {
          const error = field.validate(value, data)
          if (error) {
            formErrors.push({ field: field.name, message: error })
          }
        }
      }

      errorsRef.current = formErrors
      notifyErrorListeners()
      return formErrors
    },
    [getFieldValue, getFieldValues, notifyErrorListeners]
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
        getErrors: () => errorsRef.current,
        clearErrors,
        setFieldError,
        clearFieldError,
        isDirty,
        getDirtyBreakdown,
        subscribeField,
        subscribeErrors,
        subscribeMeta,
        addPendingUpload,
        removePendingUpload,
        getPendingUploads,
        hasPendingUploads,
        clearPendingUploads,
        setFieldUploading,
        getIsFieldUploading,
        subscribeFieldUploading,
        getSystemPath,
        setSystemPath,
        subscribeSystemPath,
        getSystemAvailableLocales,
        setSystemAvailableLocales,
        subscribeSystemAvailableLocales,
      }}
    >
      {children}
    </FormContext.Provider>
  )
}

/**
 * Subscribe to the system `path` slot edited by the path widget.
 * Returns the current value (or `null` when no override is set).
 */
export const useSystemPath = (): string | null => {
  const { getSystemPath, subscribeSystemPath } = useFormContext()
  const [value, setValue] = useState<string | null>(() => getSystemPath())

  useEffect(() => {
    return subscribeSystemPath((next) => setValue(next))
  }, [subscribeSystemPath])

  return value
}

/**
 * Subscribe to the system `availableLocales` slot edited by the
 * available-locales widget. Returns the current advertised set (or `[]` when
 * nothing is advertised / not yet surfaced).
 */
export const useSystemAvailableLocales = (): string[] => {
  const { getSystemAvailableLocales, subscribeSystemAvailableLocales } = useFormContext()
  const [value, setValue] = useState<string[]>(() => getSystemAvailableLocales())

  useEffect(() => {
    return subscribeSystemAvailableLocales((next) => setValue(next))
  }, [subscribeSystemAvailableLocales])

  return value
}

export const useFormStore = () => {
  return useFormContext()
}

export const useFieldError = (name: string) => {
  const { getErrors, subscribeErrors } = useFormContext()
  // Seed from the live errors ref via getErrors() rather than the context's
  // `errors` snapshot — the snapshot is bound at FormProvider's first render
  // and goes stale as soon as validateForm replaces errorsRef.current. Fields
  // mounted after validation has already run (e.g. switching to a tab whose
  // error badge is non-zero) would otherwise initialise to undefined and miss
  // the existing error until something else fires notifyErrorListeners.
  const [error, setError] = useState<string | undefined>(
    () => getErrors().find((e) => e.field === name)?.message
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

/**
 * Subscribe to a single field's upload-in-flight state. Returns `true` while
 * the form orchestrator is actively transporting this field's pending upload
 * (between the `setFieldUploading(path, true)` and the matching `false`
 * emitted by the upload executor's progress callback).
 */
export const useIsFieldUploading = (fieldPath: string): boolean => {
  const { getIsFieldUploading, subscribeFieldUploading } = useFormContext()
  const [uploading, setUploading] = useState<boolean>(() => getIsFieldUploading(fieldPath))

  useEffect(() => {
    return subscribeFieldUploading(fieldPath, (next) => {
      setUploading(next)
    })
  }, [subscribeFieldUploading, fieldPath])

  return uploading
}
