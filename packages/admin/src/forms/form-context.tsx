'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'

import type { Field, FieldBeforeChangeResult, FieldHookContext } from '@byline/core'
import { normalizeHooks, validateDocumentFields } from '@byline/core'
import type { DocumentPatch, FieldSetPatch } from '@byline/core/patches'

import { FormDomScopeProvider } from './form-dom-scope'
// Vendored nested get/set (see ./nested-path) — removes the lodash-es dep
// outright. A bare `from 'lodash-es'` import otherwise pools into a single
// ~85KB chunk that leaks onto the public frontend bundle (form-context is
// reachable from the layout graph).
import { get as getNestedValue, hasExistingIdTargets, withValue } from './nested-path'
import { deletePendingUploadsUnderPath } from './pending-uploads'
import { useTrackedSlot } from './use-tracked-slot'

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
 * each through its own write path. See docs/08-internationalization/index.md.
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
  /**
   * The persisted document id when the form edits an existing document,
   * `null` while the document is unsaved (create mode). Upload widgets use
   * this to honour `upload.requireSavedDocument` (see `UploadConfig` in
   * `@byline/core`).
   */
  documentId: string | null
  /**
   * Path of the collection this form edits, `null` when the form is rendered
   * without one. Upload widgets need it to address the upload endpoint.
   *
   * It lives here rather than being passed down because it is constant for
   * the whole form: threading it as a prop meant every nesting-capable
   * container (`array`, `group`, `blocks`) had to remember to forward it,
   * and a container that forgot silently rendered upload fields read-only —
   * no error, just a missing drop zone. That happened twice, in `array` /
   * `group` and then in `blocks`. A value read from context cannot be
   * dropped by a container that never carries it.
   */
  collectionPath: string | null
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
  validateForm: (fields: Field[], additionalErrors?: FormError[]) => FormError[]
  trackFieldChange: (pending: Promise<void>) => () => void
  waitForFieldChanges: () => Promise<void>
  errors: FormError[]
  getErrors: () => FormError[]
  clearErrors: () => void
  setFieldError: (field: string, message: string) => void
  clearFieldError: (field: string) => void
  isDirty: (fieldName: string) => boolean
  /**
   * Partition the current dirty state into content vs. system-field (path /
   * advertised-locales) writes so the Save button can branch. See
   * docs/08-internationalization/index.md.
   */
  getDirtyBreakdown: () => DirtyBreakdown
  subscribeField: (name: string, listener: FieldListener) => () => void
  subscribeErrors: (listener: ErrorsListener) => () => void
  subscribeMeta: (listener: MetaListener) => () => void
  // Pending uploads (deferred until save)
  addPendingUpload: (fieldPath: string, upload: PendingUpload) => boolean
  removePendingUpload: (fieldPath: string) => void
  removePendingUploadsUnder: (itemPath: string) => void
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
  documentId = null,
  collectionPath = null,
}: {
  children: React.ReactNode
  initialData?: Record<string, any>
  /**
   * The persisted document id (edit mode); `null` while unsaved. Exposed on
   * the context for upload widgets honouring `upload.requireSavedDocument`.
   */
  documentId?: string | null
  /**
   * Path of the collection being edited. Exposed on the context so upload
   * widgets can reach the upload endpoint from any nesting depth without
   * every container forwarding it — see `FormContextType.collectionPath`.
   */
  collectionPath?: string | null
}) => {
  const fieldValues = useRef<Record<string, any>>(
    JSON.parse(JSON.stringify(initialData?.fields ?? initialData))
  )
  const errorsRef = useRef<FormError[]>([])
  const dirtyFields = useRef<Set<string>>(new Set())
  const patchesRef = useRef<DocumentPatch[]>([])
  const pendingUploadsRef = useRef<Map<string, PendingUpload>>(new Map())
  const uploadingFieldsRef = useRef<Set<string>>(new Set())
  const uploadingListenersRef = useRef<Map<string, Set<FieldUploadingListener>>>(new Map())

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

  // Document-grain system-field slots — dirty-tracked, ref-backed, each with
  // its own listener set. The `path` slot is initialised from the loaded
  // version's top-level `path` (edit) or `null` (create); the available-locales
  // slot from `availableLocales` (edit) or `[]`. Edits toggle the slot's dirty
  // key so the single Save button can branch. See ./use-tracked-slot.
  const pathSlot = useTrackedSlot<string | null>({
    initial:
      typeof initialData?.path === 'string' && (initialData.path as string).length > 0
        ? (initialData.path as string)
        : null,
    dirtyKey: SYSTEM_PATH_DIRTY_KEY,
    dirtyFields,
    notifyMeta: notifyMetaListeners,
  })

  const availableLocalesSlot = useTrackedSlot<string[]>({
    initial: Array.isArray(initialData?.availableLocales) ? [...initialData.availableLocales] : [],
    dirtyKey: SYSTEM_AVAILABLE_LOCALES_DIRTY_KEY,
    dirtyFields,
    notifyMeta: notifyMetaListeners,
    // The slot holds an array; a fresh reference is never `===` its baseline,
    // so dirty tracking compares membership, not identity. Stored as a copy.
    isEqual: sameLocaleSet,
    clone: (value) => [...value],
  })

  const updateFieldStoreInternal = useCallback(
    (name: string, value: any) => {
      const newFieldValues = withValue(fieldValues.current, name, value)
      if (!newFieldValues) return false

      fieldValues.current = newFieldValues
      dirtyFields.current.add(name)

      notifyFieldListeners(name, value)
      notifyMetaListeners()
      return true
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
      if (!updateFieldStoreInternal(name, value)) return

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
      // Snapshot the patch at append time. Structural patches (array.insert,
      // block add) carry item objects that are ALSO placed into the form
      // store — and `setNestedValue` mutates store nodes in place, so a
      // later nested write inside the item (e.g. adding an array item to a
      // block added this session) would silently rewrite the queued patch.
      // Serialized at save time, the block insert would then already contain
      // the array items AND the array.insert patches would re-add them —
      // duplicating items server-side (caught by e2e/array-in-block.spec.ts).
      patchesRef.current = [...patchesRef.current, structuredClone(patch)]
      // Mark a generic dirty flag so hasChanges() becomes true even
      // for patches that don't correspond to a specific field.set.
      dirtyFields.current.add('__patch__')
      notifyMetaListeners()
      // Dev-time patch tracing — uncomment when debugging the patch stream.
      // if (process.env.NODE_ENV !== 'production') {
      //   // eslint-disable-next-line no-console
      //   console.debug('FormContext.appendPatch', { patch, dirtyCount: dirtyFields.current.size })
      // }
    },
    [notifyMetaListeners]
  )

  // The store starts with the complete initial snapshot. Falling back to that
  // snapshot after an ancestor is cleared would resurrect removed descendants.
  const getFieldValue = useCallback((name: string) => getNestedValue(fieldValues.current, name), [])

  const hasChanges = useCallback(() => {
    return dirtyFields.current.size > 0
  }, [])

  const resetHasChanges = useCallback(() => {
    dirtyFields.current.clear()
    patchesRef.current = []
    pathSlot.commitInitial()
    availableLocalesSlot.commitInitial()
    notifyMetaListeners()
  }, [notifyMetaListeners, pathSlot.commitInitial, availableLocalesSlot.commitInitial])

  const isDirty = useCallback((fieldName: string) => {
    return dirtyFields.current.has(fieldName)
  }, [])

  // Partition the current dirty set by write semantics so the single Save
  // button can route each piece correctly: content → versioned write; the
  // document-grain system fields (path / advertised locales) → immediate,
  // non-versioned direct write that leaves workflow status untouched.
  // See docs/08-internationalization/index.md.
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

  // ---------------------------------------------------------------------------
  // Pending uploads (deferred until save)
  // ---------------------------------------------------------------------------

  const addPendingUpload = useCallback(
    (fieldPath: string, upload: PendingUpload) => {
      // Image metadata extraction is asynchronous. If its containing item was
      // removed while decoding, discard the late registration rather than
      // allowing submit to recreate or overwrite an item through a stale path.
      if (!hasExistingIdTargets(fieldValues.current, fieldPath)) {
        URL.revokeObjectURL(upload.previewUrl)
        return false
      }

      // If there's an existing pending upload for this path, revoke its blob URL
      const existing = pendingUploadsRef.current.get(fieldPath)
      if (existing) {
        URL.revokeObjectURL(existing.previewUrl)
      }
      pendingUploadsRef.current.set(fieldPath, upload)
      dirtyFields.current.add(fieldPath)
      notifyMetaListeners()
      return true
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

  const removePendingUploadsUnder = useCallback(
    (itemPath: string) => {
      const deleted = deletePendingUploadsUnderPath(pendingUploadsRef.current, itemPath, (url) =>
        URL.revokeObjectURL(url)
      )
      if (deleted) notifyMetaListeners()
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

  const fieldChanges = useRef(new Set<Promise<void>>())
  const fieldChangeWaiters = useRef(new Set<() => void>())
  const trackFieldChange = useCallback((pending: Promise<void>) => {
    fieldChanges.current.add(pending)
    const release = () => {
      fieldChanges.current.delete(pending)
      if (fieldChanges.current.size === 0) {
        for (const resolve of fieldChangeWaiters.current) resolve()
        fieldChangeWaiters.current.clear()
      }
    }
    void pending.then(release, release)
    return release
  }, [])
  const waitForFieldChanges = useCallback(async () => {
    while (fieldChanges.current.size)
      await new Promise<void>((resolve) => fieldChangeWaiters.current.add(resolve))
  }, [])

  const validateForm = useCallback(
    (fields: Field[], additionalErrors: FormError[] = []): FormError[] => {
      const formErrors = validateDocumentFields(fields, getFieldValues(), {
        respectConditions: true,
        skip: (path) => pendingUploadsRef.current.has(path),
      })
      errorsRef.current = [...additionalErrors, ...formErrors]
      notifyErrorListeners()
      return errorsRef.current
    },
    [getFieldValues, notifyErrorListeners]
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

        // Condition-hidden fields skip submit-time hooks, mirroring their
        // exemption from validateForm below. A predicate that throws leaves the
        // field visible, matching the render hook and the validation walker: the
        // hooks run, and validateForm reports the failure as a field error
        // rather than the exception rejecting submission before anything can be
        // shown.
        if (field.condition) {
          let visible = true
          try {
            visible = Boolean(field.condition(data, data))
          } catch {
            // Reported by validateForm, which evaluates the same predicate.
          }
          if (!visible) continue
        }

        const path = field.name
        const value = getFieldValue(path)

        const ctx: FieldHookContext = {
          value,
          previousValue: value,
          data,
          path,
          field,
          operation: 'submit',
          setFieldValue,
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

  const resetPatches = useCallback(() => {
    patchesRef.current = []
  }, [])
  const getErrors = useCallback(() => errorsRef.current, [])
  const context = useMemo(
    () => ({
      documentId,
      collectionPath,
      setFieldValue,
      setFieldStore,
      getFieldValue,
      getFieldValues,
      getPatches,
      appendPatch,
      resetPatches,
      hasChanges,
      resetHasChanges,
      runFieldHooks,
      validateForm,
      get errors() {
        return errorsRef.current
      },
      getErrors,
      trackFieldChange,
      waitForFieldChanges,
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
      removePendingUploadsUnder,
      getPendingUploads,
      hasPendingUploads,
      clearPendingUploads,
      setFieldUploading,
      getIsFieldUploading,
      subscribeFieldUploading,
      getSystemPath: pathSlot.get,
      setSystemPath: pathSlot.set,
      subscribeSystemPath: pathSlot.subscribe,
      getSystemAvailableLocales: availableLocalesSlot.get,
      setSystemAvailableLocales: availableLocalesSlot.set,
      subscribeSystemAvailableLocales: availableLocalesSlot.subscribe,
    }),
    [
      documentId,
      collectionPath,
      setFieldValue,
      setFieldStore,
      getFieldValue,
      getFieldValues,
      getPatches,
      appendPatch,
      resetPatches,
      hasChanges,
      resetHasChanges,
      runFieldHooks,
      validateForm,
      getErrors,
      trackFieldChange,
      waitForFieldChanges,
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
      removePendingUploadsUnder,
      getPendingUploads,
      hasPendingUploads,
      clearPendingUploads,
      setFieldUploading,
      getIsFieldUploading,
      subscribeFieldUploading,
      pathSlot.get,
      pathSlot.set,
      pathSlot.subscribe,
      availableLocalesSlot.get,
      availableLocalesSlot.set,
      availableLocalesSlot.subscribe,
    ]
  )

  return (
    <FormContext.Provider value={context}>
      <FormDomScopeProvider>{children}</FormDomScopeProvider>
    </FormContext.Provider>
  )
}

/**
 * Subscribe to the system `path` slot edited by the path widget.
 * Returns the current value (or `null` when no override is set).
 */
export const useSystemPath = (): string | null => {
  const { getSystemPath, subscribeSystemPath } = useFormContext()
  return useSyncExternalStore(subscribeSystemPath, getSystemPath, getSystemPath)
}

export const useSystemAvailableLocales = (): string[] => {
  const { getSystemAvailableLocales, subscribeSystemAvailableLocales } = useFormContext()
  return useSyncExternalStore(
    subscribeSystemAvailableLocales,
    getSystemAvailableLocales,
    getSystemAvailableLocales
  )
}

export const useFormStore = () => useFormContext()

export const useFieldError = (name: string) => {
  const { getErrors, subscribeErrors } = useFormContext()
  const errors = useSyncExternalStore(subscribeErrors, getErrors, getErrors)
  return errors.find((error) => error.field === name)?.message
}

export const useFormMeta = () => {
  const { hasChanges, subscribeMeta } = useFormContext()
  return { hasChanges: useSyncExternalStore(subscribeMeta, hasChanges, hasChanges) }
}

export const useIsDirty = (name: string) => {
  const { isDirty, subscribeMeta } = useFormContext()
  const snapshot = useCallback(() => isDirty(name), [isDirty, name])
  return useSyncExternalStore(subscribeMeta, snapshot, snapshot)
}

export const useFieldValue = <T = any>(name: string): T | undefined => {
  const { getFieldValue, subscribeMeta } = useFormContext()
  const snapshot = useCallback(() => getFieldValue(name), [getFieldValue, name])
  // Ancestor replacement and descendant edits both affect a composite value.
  // Structural sharing keeps unrelated field snapshots referentially stable.
  return useSyncExternalStore(subscribeMeta, snapshot, snapshot)
}

export const useIsFieldUploading = (fieldPath: string): boolean => {
  const { getIsFieldUploading, subscribeFieldUploading } = useFormContext()
  const subscribe = useCallback(
    (notify: () => void) => subscribeFieldUploading(fieldPath, notify),
    [subscribeFieldUploading, fieldPath]
  )
  const snapshot = useCallback(
    () => getIsFieldUploading(fieldPath),
    [getIsFieldUploading, fieldPath]
  )
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
