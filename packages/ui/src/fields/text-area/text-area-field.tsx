/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback } from 'react'

import type { Field, FieldComponentSlots, TextAreaField as FieldType } from '@byline/core'
import { Label, TextArea } from '@infonomic/uikit/react'
import cx from 'classnames'

import { useFieldError, useFieldValue } from '../../forms/form-context'
import { LocaleBadge } from '../locale-badge'
import styles from './text-area-field.module.css'

export const TextAreaField = ({
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

  // When a locale is active, render a custom Label+badge and suppress the
  // TextArea's own label so the locale indicator appears in the label row.
  const showBadge = !!locale && !!field.label

  // Determine whether the label is handled externally (by a custom slot or
  // the locale badge row) so TextArea doesn't render its own.
  const hasCustomLabel = !!CustomLabel
  const suppressInputLabel = showBadge || hasCustomLabel
  const suppressInputHelpText = !!CustomHelpText

  const labelRowClass = cx('byline-field-text-area-label-row', styles['label-row'])

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
    if (showBadge) {
      return (
        <div className={labelRowClass}>
          <Label
            id={`${htmlId}-label`}
            htmlFor={htmlId}
            label={field.label!}
            required={!field.optional}
          />
          <LocaleBadge locale={locale!} />
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
      <TextArea
        id={htmlId}
        name={field.name}
        label={suppressInputLabel ? undefined : field.label}
        required={!field.optional}
        helpText={suppressInputHelpText ? undefined : field.helpText}
        value={incomingValue}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange(e.target.value)}
        error={fieldError != null}
        errorText={fieldError}
        rows={4}
      />
    )
  }

  return (
    <div className={`byline-field-text-area ${field.name}`}>
      {renderLabel()}
      {BeforeField && <BeforeField {...slotBaseProps} />}
      {renderInput()}
      {AfterField && <AfterField {...slotBaseProps} />}
      {CustomHelpText && <CustomHelpText {...slotBaseProps} helpText={field.helpText} />}
    </div>
  )
}
