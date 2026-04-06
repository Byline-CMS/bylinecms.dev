/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  DecimalField,
  Field,
  FieldComponentSlots,
  FloatField,
  IntegerField,
} from '@byline/core'
import { Input } from '@infonomic/uikit/react'

import { useFieldError, useFieldValue } from '../../forms/form-context'

export const NumericalField = ({
  field,
  value,
  defaultValue,
  onChange,
  id,
  path,
  components,
}: {
  field: IntegerField | FloatField | DecimalField
  value?: string | number | null
  defaultValue?: string | number | null
  onChange?: (value: string) => void
  id?: string
  path?: string
  /** Optional UI component slot overrides from the admin config. */
  components?: FieldComponentSlots
}) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  // const isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<string | number | undefined>(fieldPath)
  const incomingValue = value ?? fieldValue ?? defaultValue ?? ''
  const htmlId = id ?? fieldPath
  const displayValue =
    incomingValue === undefined || incomingValue === null ? '' : String(incomingValue)

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
          onChange={(v: any) => onChange?.(v)}
          defaultValue={defaultValue}
          placeholder={field.placeholder}
        />
      )
    }
    return (
      <Input
        type="number"
        id={htmlId}
        name={field.name}
        label={suppressInputLabel ? undefined : field.label}
        required={!field.optional}
        helpText={suppressInputHelpText ? undefined : field.helpText}
        value={displayValue}
        onChange={(e) => onChange?.(e.target.value)}
        error={fieldError != null}
        errorText={fieldError}
      />
    )
  }

  return (
    <div className={`byline-${field.type} ${field.name}`}>
      {renderLabel()}
      {BeforeField && <BeforeField {...slotBaseProps} />}
      {renderInput()}
      {AfterField && <AfterField {...slotBaseProps} />}
      {CustomHelpText && <CustomHelpText {...slotBaseProps} helpText={field.helpText} />}
    </div>
  )
}
