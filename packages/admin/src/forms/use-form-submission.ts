'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback, useRef, useState } from 'react'

import { type Field, getDocumentFieldValidationDetails } from '@byline/core'
import type { DocumentPatch } from '@byline/core/patches'
import { useTranslation } from '@byline/i18n/react'

import { useBylineFieldServices } from '../fields/field-services-context'
import { useFormContext } from './form-context'
import { executeUploadsWithProgress } from './upload-executor'

/**
 * Payload emitted by the form on Save. Carries the content (field data +
 * patches) alongside the document-grain system fields (path / advertised
 * locales) and per-bucket dirty flags so the host can route each piece to the
 * right write path — versioned for content, immediate/non-versioned for the
 * system fields. See docs/08-internationalization/index.md.
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

/**
 * Where a save has got to. Mutually exclusive by construction: the form cannot
 * be validating and uploading at once, which two independent booleans allowed.
 */
export type SubmissionPhase =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'uploading' }
  | { kind: 'confirmingSystemFields'; payload: SystemFieldsSubmitPayload }
  | { kind: 'submitting' }

export interface UseFormSubmissionOptions {
  mode: 'create' | 'edit'
  fields: Field[]
  /** Persisted document id (edit mode only); feeds server-side upload hooks. */
  documentId?: string
  /**
   * Only collections that opted into the advertised-locale widget emit the
   * locale set, so the write path never touches
   * `byline_document_available_locales` for the others.
   */
  advertiseLocales?: boolean
  onSubmit: (payload: SystemFieldsSubmitPayload) => void | Promise<void>
  /** Mutations blocked (stale/lock/discarding). Read synchronously, per call. */
  isBlocked: () => boolean
  /**
   * Called immediately before the form becomes `inert` — once before uploads
   * and once before submission — so the caller can record the focused element
   * and restore it when busy ends. The DOM refs stay in the component; the
   * hook only signals the transition.
   */
  onBeforeBusy?: () => void
}

export interface UseFormSubmissionResult {
  phase: SubmissionPhase
  isBusy: boolean
  submit: () => Promise<void>
  confirmSystemFields: () => Promise<void>
  cancelSystemFields: () => void
}

const IDLE: SubmissionPhase = { kind: 'idle' }

/**
 * Owns one save: validate → upload → (confirm) → submit.
 *
 * Admission is decided by a ref, not by `phase`. Rendered state is not a
 * re-entry guard: two `submit()` calls in the same turn both observe
 * `phase.kind === 'idle'` because React has not rerendered between them. The
 * ref is set synchronously at the top of `submit()` and cleared in `finally`,
 * spanning validation through submission — the whole window, not just the
 * final request. `phase` drives the UI; the ref decides admission.
 */
export function useFormSubmission(options: UseFormSubmissionOptions): UseFormSubmissionResult {
  const { mode, fields, documentId, advertiseLocales, onSubmit, isBlocked, onBeforeBusy } = options

  const {
    getFieldValues,
    runFieldHooks,
    validateForm,
    resetHasChanges,
    getPatches,
    getDirtyBreakdown,
    getSystemPath,
    getSystemAvailableLocales,
    setFieldValue,
    setFieldError,
    getPendingUploads,
    removePendingUpload,
    clearFieldError,
    waitForFieldChanges,
    setFieldUploading,
  } = useFormContext()
  const { t } = useTranslation('byline-admin')
  const { uploadField } = useBylineFieldServices()

  const [phase, setPhase] = useState<SubmissionPhase>(IDLE)
  const inFlightRef = useRef(false)
  const confirmationRef = useRef<SystemFieldsSubmitPayload | null>(null)

  const isBusy = phase.kind === 'uploading' || phase.kind === 'submitting'

  // Await the host handler. Resolution means the save succeeded and the clean
  // baseline can be committed; rejection preserves dirty state so the editor
  // does not lose work and the navigation guard keeps blocking. Host handlers
  // that surface their own toast MUST rethrow afterwards.
  const deliver = useCallback(
    async (payload: SystemFieldsSubmitPayload) => {
      // Settle before returning. `runUploads` may have left the phase at
      // `uploading`, and this is the only reset on the delivery path: returning
      // without it strands the form busy and inert with nothing in flight.
      // Dirty state is deliberately untouched, so the save can be retried once
      // the block clears.
      if (isBlocked() || typeof onSubmit !== 'function') {
        setPhase(IDLE)
        return
      }
      onBeforeBusy?.()
      setPhase({ kind: 'submitting' })
      try {
        await onSubmit(payload)
        resetHasChanges()
      } catch (error) {
        const validation = getDocumentFieldValidationDetails(error)
        for (const issue of validation?.issues ?? []) setFieldError(issue.field, issue.message)
        // Intentionally swallowed here — the host has already reported the
        // failure to the user. Dirty state is preserved by not resetting.
      } finally {
        setPhase(IDLE)
      }
    },
    [isBlocked, onBeforeBusy, onSubmit, resetHasChanges, setFieldError]
  )

  const runUploads = useCallback(async (): Promise<boolean> => {
    const pendingUploads = getPendingUploads()
    if (pendingUploads.size === 0) return true

    onBeforeBusy?.()
    setPhase({ kind: 'uploading' })
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
          documentId: mode === 'edit' ? documentId : undefined,
          fields,
          getFormValues: getFieldValues,
        }
      )

      // Adopt each success before reporting partial failure, so retries only
      // transport failed files. Do not overwrite a selection replaced in flight.
      for (const [fieldPath, storedFile] of uploadResult.successful) {
        if (getPendingUploads().get(fieldPath) !== pendingUploads.get(fieldPath)) continue
        setFieldValue(fieldPath, storedFile)
        clearFieldError(fieldPath)
        removePendingUpload(fieldPath)
      }
      if (!uploadResult.allSucceeded) {
        for (const [fieldPath, errorMessage] of uploadResult.errors) {
          if (getPendingUploads().get(fieldPath) === pendingUploads.get(fieldPath)) {
            setFieldError(fieldPath, t('forms.uploadFailedFieldError', { message: errorMessage }))
          }
        }
        return false
      }
      if (getPendingUploads().size > 0) return false
      return true
    } catch (err) {
      console.error('Upload execution error:', err)
      return false
    }
  }, [
    removePendingUpload,
    clearFieldError,
    documentId,
    fields,
    getFieldValues,
    getPendingUploads,
    mode,
    onBeforeBusy,
    setFieldError,
    setFieldUploading,
    setFieldValue,
    t,
    uploadField,
  ])

  const buildPayload = useCallback((): { payload: SystemFieldsSubmitPayload; reason: string } => {
    const { contentDirty, pathDirty, availableLocalesDirty, reason } = getDirtyBreakdown()
    return {
      reason,
      payload: {
        data: structuredClone(getFieldValues()),
        patches: structuredClone(getPatches()),
        contentDirty,
        pathDirty,
        systemPath: getSystemPath(),
        availableLocalesDirty,
        systemAvailableLocales: advertiseLocales ? getSystemAvailableLocales() : undefined,
      },
    }
  }, [
    advertiseLocales,
    getDirtyBreakdown,
    getFieldValues,
    getPatches,
    getSystemAvailableLocales,
    getSystemPath,
  ])

  const submit = useCallback(async () => {
    if (isBlocked()) return
    if (inFlightRef.current || confirmationRef.current) return
    inFlightRef.current = true
    try {
      setPhase({ kind: 'validating' })

      // Run field-level beforeValidate hooks (submit-time), then validate
      await waitForFieldChanges()
      if (isBlocked()) {
        setPhase(IDLE)
        return
      }
      // Metadata-only saves do not create a content version and must remain
      // available even when an older document lacks newly required fields.
      if (mode !== 'edit' || getDirtyBreakdown().reason !== 'direct-write') {
        const hookErrors = await runFieldHooks(fields)
        const formErrors = validateForm(fields, hookErrors)
        if (formErrors.length > 0) {
          console.error('Form validation failed:', formErrors)
          setPhase(IDLE)
          return
        }
      }

      if (isBlocked()) {
        setPhase(IDLE)
        return
      }

      if (!(await runUploads())) {
        setPhase(IDLE)
        return
      }

      const { payload, reason } = buildPayload()

      // Editing the document-grain system fields (path / advertised locales) is
      // an immediate, non-versioned write that does NOT reset workflow status,
      // so confirm it before saving. Create mode writes everything as part of
      // the initial version, so no confirmation applies there.
      if (mode === 'edit' && (reason === 'direct-write' || reason === 'both')) {
        confirmationRef.current = payload
        setPhase({ kind: 'confirmingSystemFields', payload })
        return
      }

      await deliver(payload)
    } finally {
      inFlightRef.current = false
    }
  }, [
    buildPayload,
    getDirtyBreakdown,
    deliver,
    fields,
    isBlocked,
    mode,
    runUploads,
    runFieldHooks,
    validateForm,
    waitForFieldChanges,
  ])

  const confirmSystemFields = useCallback(async () => {
    if (phase.kind !== 'confirmingSystemFields' || confirmationRef.current !== phase.payload) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    const { payload } = phase
    confirmationRef.current = null
    try {
      await deliver(payload)
    } finally {
      inFlightRef.current = false
    }
  }, [deliver, phase])

  const cancelSystemFields = useCallback(() => {
    confirmationRef.current = null
    setPhase((current) => (current.kind === 'confirmingSystemFields' ? IDLE : current))
  }, [])

  return { phase, isBusy, submit, confirmSystemFields, cancelSystemFields }
}
