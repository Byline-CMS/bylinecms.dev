/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import React, { Suspense, useCallback } from 'react'

import type { Field, FieldComponentSlots, CodeField as FieldType } from '@byline/core'
import { ErrorText, HelpText, Label } from '@byline/ui/react'
import cx from 'classnames'

import { useFieldError, useFieldValue } from '../../forms/form-context'
import { LocaleBadge } from '../locale-badge'
import styles from './code-field.module.css'

// The CodeMirror half of the widget. `React.lazy` is the bundle-splitting
// boundary: `code-editor.tsx` owns every CodeMirror import, so the editor
// (and its per-language grammars) stays out of the main admin chunk and is
// fetched the first time a code field actually renders.
const CodeEditor = React.lazy(() => import('./code-editor'))

/**
 * Resolve the form-store path of a sibling field (same group/block/array
 * item scope). `content[id=x].code` + `language` → `content[id=x].language`;
 * a top-level `code` + `language` → `language`.
 */
const siblingFieldPath = (fieldPath: string, siblingName: string): string => {
  const lastDot = fieldPath.lastIndexOf('.')
  return lastDot === -1 ? siblingName : `${fieldPath.slice(0, lastDot + 1)}${siblingName}`
}

export const CodeField = ({
  field,
  value,
  defaultValue,
  onChange,
  id,
  path,
  locale,
  components,
}: {
  field: FieldType
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  id?: string
  path?: string
  /** When provided, renders a LocaleBadge next to the field label. */
  locale?: string
  /** Optional UI component slot overrides from the admin config. */
  components?: FieldComponentSlots
}) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  const fieldValue = useFieldValue<string | undefined>(fieldPath)
  const incomingValue = value ?? fieldValue ?? defaultValue ?? ''
  const htmlId = id ?? fieldPath

  // Effective highlight language: a sibling `languageField` selection (e.g.
  // a `select` next to the code field) wins over the schema's static
  // `language` hint. The hook subscribes to the sibling path, so switching
  // the select re-highlights live. When no `languageField` is declared we
  // subscribe to our own path — a stable no-op (hooks must run
  // unconditionally).
  const siblingPath = field.languageField
    ? siblingFieldPath(fieldPath, field.languageField)
    : fieldPath
  const siblingLanguage = useFieldValue<string | undefined>(siblingPath)
  const effectiveLanguage = (field.languageField ? siblingLanguage : undefined) || field.language

  const handleChange = useCallback(
    (value: string) => {
      if (onChange) {
        onChange(value)
      }
    },
    [onChange]
  )

  // Custom component slots (from admin config)
  const slots = components
  const CustomLabel = slots?.Label
  const CustomHelpText = slots?.HelpText
  const CustomField = slots?.Field
  const BeforeField = slots?.beforeField
  const AfterField = slots?.afterField

  // Shared props available to every slot component
  const slotBaseProps = {
    field: field as Field,
    path: fieldPath,
    value: incomingValue,
    error: fieldError,
    id: htmlId,
  }

  const showBadge = !!locale && !!field.label
  const hasCustomLabel = !!CustomLabel

  const labelRowClass = cx('byline-field-code-label-row', styles['label-row'])

  // ── Label rendering ──────────────────────────────────────────
  const renderLabel = () => {
    if (hasCustomLabel) {
      return (
        <div className={labelRowClass}>
          <CustomLabel {...slotBaseProps} label={field.label} required={!field.optional} />
          {showBadge && <LocaleBadge locale={locale!} />}
        </div>
      )
    }
    if (field.label) {
      return (
        <div className={labelRowClass}>
          <Label
            id={`${htmlId}-label`}
            htmlFor={htmlId}
            label={field.label}
            required={!field.optional}
          />
          {showBadge && <LocaleBadge locale={locale!} />}
        </div>
      )
    }
    return null
  }

  // ── Field input rendering ────────────────────────────────────
  const renderInput = () => {
    if (CustomField) {
      return (
        <CustomField
          {...slotBaseProps}
          onChange={handleChange}
          defaultValue={defaultValue}
          placeholder={field.placeholder}
        />
      )
    }
    return (
      <Suspense
        fallback={
          // Read-only monospace textarea: keeps the layout stable and the
          // content visible while the editor chunk loads.
          <textarea
            className={cx('byline-field-code-loading', styles.loading)}
            readOnly
            value={incomingValue}
            rows={6}
            aria-label={field.label}
          />
        }
      >
        <CodeEditor
          id={htmlId}
          value={incomingValue}
          language={effectiveLanguage}
          onChange={handleChange}
          readOnly={field.readOnly === true}
          ariaInvalid={fieldError != null}
          ariaDescribedBy={
            fieldError != null
              ? `error-for-${htmlId}`
              : field.helpText
                ? `help-for-${htmlId}`
                : undefined
          }
        />
      </Suspense>
    )
  }

  return (
    <div className={`byline-field-code ${field.name}`}>
      {renderLabel()}
      {BeforeField && <BeforeField {...slotBaseProps} />}
      {renderInput()}
      {AfterField && <AfterField {...slotBaseProps} />}
      {fieldError != null && <ErrorText id={`error-for-${htmlId}`} text={fieldError} />}
      {CustomHelpText ? (
        <CustomHelpText {...slotBaseProps} helpText={field.helpText} />
      ) : (
        fieldError == null &&
        field.helpText && <HelpText id={`help-for-${htmlId}`} text={field.helpText} />
      )}
    </div>
  )
}
