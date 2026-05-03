/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'

import type { RichTextField as FieldType } from '@byline/core'
import { LocaleBadge, useFieldError, useFieldValue } from '@byline/ui'
import { ErrorText, Label } from '@infonomic/uikit/react'
import cx from 'classnames'

import { defaultEditorConfig } from './field/config/default'
import { EditorField } from './field/editor-field'
import styles from './richtext-field.module.css'
import type { EditorConfig } from './field/config/types'

interface Props {
  field: FieldType
  readonly?: boolean
  instanceKey?: string
  value?: any
  defaultValue?: any
  editorConfig?: EditorConfig
  onChange?: (value: any) => void
  path?: string
  /** When provided, renders a LocaleBadge next to the field label. */
  locale?: string
}

export const RichTextField = ({
  field,
  value,
  defaultValue,
  editorConfig,
  readonly = false,
  instanceKey,
  onChange,
  path,
  locale,
}: Props) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  const fieldValue = useFieldValue<any>(fieldPath)
  const incomingValue = value ?? fieldValue
  const incomingDefault = defaultValue

  const fieldId = instanceKey ? `${field.name}-${instanceKey}` : field.name

  // Resolve the editor config with field-level priority:
  //   1. `field.editorConfig` — set on the schema field itself (most specific).
  //   2. `editorConfig` prop  — baked in at registration via `lexicalEditor()`.
  //   3. `defaultEditorConfig` — package default.
  // The schema-level value is typed as `unknown` at the `@byline/core` boundary,
  // so the cast lives here where the Lexical config shape is known.
  const baseEditorConfig: EditorConfig =
    (field.editorConfig as EditorConfig | undefined) ?? editorConfig ?? defaultEditorConfig

  // Adapter-agnostic field-level lever — when present, override the resolved
  // editor settings so the inline-image / link modals see this field's policy.
  const resolvedEditorConfig: EditorConfig =
    field.embedRelationsOnSave === undefined
      ? baseEditorConfig
      : {
          ...baseEditorConfig,
          settings: {
            ...baseEditorConfig.settings,
            embedRelationsOnSave: field.embedRelationsOnSave,
          },
        }

  // Assemble the label node here (a Byline-level concern) so that the editor
  // component itself stays free of any Byline-specific dependencies.
  const labelNode: React.ReactNode =
    locale && field.label ? (
      <div className={cx('byline-field-richtext-label', styles['label-row'])}>
        <Label
          id={`${fieldId}-label`}
          label={field.label}
          htmlFor={fieldId}
          required={!field.optional}
        />
        <LocaleBadge locale={locale} />
      </div>
    ) : (
      field.label
    )

  return (
    <div className={cx('byline-field-richtext', field.name, styles.wrapper)}>
      <div className={cx('byline-field-richtext-body', styles.body)}>
        <EditorField
          onChange={onChange}
          editorConfig={resolvedEditorConfig}
          id={fieldId}
          name={field.name}
          description={field.helpText}
          readonly={readonly}
          label={labelNode}
          required={!field.optional}
          value={incomingValue}
          defaultValue={incomingDefault}
          // Ensure React fully remounts when instanceKey changes
          key={fieldId}
        />
        {fieldError && <ErrorText id={`${field.name}-error`} text={fieldError} />}
      </div>
    </div>
  )
}
