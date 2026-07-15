/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'

import type {
  CounterField,
  DecimalField,
  Field,
  FieldComponentSlots,
  FloatField,
  IntegerField,
} from '@byline/core'
import { normalizeNumericValue } from '@byline/core'
import { Input } from '@byline/ui/react'

import { useFieldError, useFieldValue } from '../../forms/form-context'

type NumericalValue = string | number | null

const COMPLETE_NUMERIC_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export const NumericalField = ({
  field,
  value,
  defaultValue,
  onChange,
  id,
  path,
  components,
}: {
  field: IntegerField | FloatField | DecimalField | CounterField
  value?: string | number | null
  defaultValue?: string | number | null
  onChange?: (value: NumericalValue) => void
  id?: string
  path?: string
  /** Optional UI component slot overrides from the admin config. */
  components?: FieldComponentSlots
}) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  const fieldValue = useFieldValue<NumericalValue | undefined>(fieldPath)
  const incomingValue =
    value !== undefined ? value : fieldValue !== undefined ? fieldValue : (defaultValue ?? null)
  const htmlId = id ?? fieldPath
  const canonicalDisplay = incomingValue == null ? '' : String(incomingValue)
  const [displayValue, setDisplayValue] = useState(canonicalDisplay)
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    if (!isEditing) setDisplayValue(canonicalDisplay)
  }, [canonicalDisplay, isEditing])

  const canonicalize = (nextValue: NumericalValue): NumericalValue | undefined => {
    if (nextValue == null || (typeof nextValue === 'string' && nextValue.trim() === '')) return null
    if (field.type === 'counter') return undefined
    if (typeof nextValue === 'string' && !COMPLETE_NUMERIC_RE.test(nextValue.trim())) {
      return undefined
    }
    try {
      return normalizeNumericValue(field.type, nextValue, fieldPath)
    } catch {
      return undefined
    }
  }

  const commit = (nextValue: NumericalValue) => {
    const canonical = canonicalize(nextValue)
    if (canonical !== undefined) onChange?.(canonical)
    return canonical
  }

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

  const hasCustomLabel = !!CustomLabel
  const suppressInputLabel = hasCustomLabel
  const suppressInputHelpText = !!CustomHelpText

  // ── Label rendering ──────────────────────────────────────────
  const renderLabel = () => {
    if (hasCustomLabel) {
      return <CustomLabel {...slotBaseProps} label={field.label} required={!field.optional} />
    }
    return null
  }

  // ── Field input rendering ────────────────────────────────────
  const renderInput = () => {
    if (CustomField) {
      return (
        <CustomField
          {...slotBaseProps}
          onChange={(nextValue: NumericalValue) => commit(nextValue)}
          defaultValue={defaultValue}
          placeholder={field.placeholder}
        />
      )
    }
    return (
      <Input
        type="text"
        inputMode={field.type === 'integer' || field.type === 'counter' ? 'numeric' : 'decimal'}
        step={field.type === 'integer' || field.type === 'counter' ? 1 : 'any'}
        id={htmlId}
        name={field.name}
        label={suppressInputLabel ? undefined : field.label}
        required={!field.optional}
        readOnly={field.readOnly}
        helpText={suppressInputHelpText ? undefined : field.helpText}
        value={displayValue}
        onFocus={() => setIsEditing(true)}
        onChange={(e) => {
          setDisplayValue(e.target.value)
          commit(e.target.value)
        }}
        onBlur={() => {
          setIsEditing(false)
          const canonical = commit(displayValue)
          setDisplayValue(
            canonical === undefined ? canonicalDisplay : (canonical?.toString() ?? '')
          )
        }}
        error={fieldError != null}
        errorText={fieldError}
      />
    )
  }

  return (
    <div className={`byline-field-${field.type} ${field.name}`}>
      {renderLabel()}
      {BeforeField && <BeforeField {...slotBaseProps} />}
      {renderInput()}
      {AfterField && <AfterField {...slotBaseProps} />}
      {CustomHelpText && <CustomHelpText {...slotBaseProps} helpText={field.helpText} />}
    </div>
  )
}
