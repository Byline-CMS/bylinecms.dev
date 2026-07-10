/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'

import { LocaleBadge, useFieldError, useFieldValue } from '@byline/admin/react'
import type { RichTextField as FieldType } from '@byline/core'
import { ErrorText, Label } from '@byline/ui/react'
import cx from 'classnames'

import { defaultEditorConfig } from './field/config/default'
import { defaultExtensionsList } from './field/config/default-extensions'
import { resolveEditorConfig } from './field/config/resolve-editor-config'
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
  /**
   * Feature nodes rendered **before** the editor surface (inside the
   * `LexicalComposer` tree, so plugins can use `useLexicalComposerContext`).
   * Use for plugins like AI assistants that need editor access.
   */
  featureBeforeEditor?: React.ReactNode[]
  /**
   * Feature nodes rendered **after** the editor surface. Same composer
   * context as `featureBeforeEditor`.
   */
  featureAfterEditor?: React.ReactNode[]
  /**
   * Feature nodes rendered as additional composer children — e.g. plugins
   * that need to register commands or listeners without rendering UI.
   */
  featureChildren?: React.ReactNode[]
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
  featureBeforeEditor,
  featureAfterEditor,
  featureChildren,
}: Props) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  const fieldValue = useFieldValue<any>(fieldPath)
  const incomingValue = value ?? fieldValue
  const incomingDefault = defaultValue

  const fieldId = instanceKey ? `${field.name}-${instanceKey}` : field.name

  // Resolve the editor config by MERGING the schema field's `editorConfig`
  // (settings-only, most specific) over the registered editor's config
  // (baked via `lexicalEditor()`, the only layer that can carry an
  // `extensions` graph) — see `resolveEditorConfig` for the full rationale.
  // The schema-level value is typed as `unknown` at the `@byline/core`
  // boundary, so the cast lives here where the Lexical config shape is known.
  const resolved: EditorConfig = resolveEditorConfig(
    field.editorConfig as EditorConfig | undefined,
    editorConfig ?? defaultEditorConfig
  )
  // The server-safe `defaultEditorConfig` carries no `extensions` field —
  // extension references aren't JSON-safe. Materialise the package's
  // client-only default list when one isn't already present so every render
  // has a complete graph to feed `EditorContext`.
  const baseEditorConfig: EditorConfig =
    resolved.extensions != null ? resolved : { ...resolved, extensions: defaultExtensionsList() }

  // `field.embedRelationsOnSave` is a server-side flag — read by the
  // document-lifecycle write path's richtext embed walker. The client
  // editor no longer reads it (the modals always embed picker-time
  // envelopes; the server walker refreshes them on save), so nothing
  // here needs to propagate the field-level value into `EditorSettings`.
  const resolvedEditorConfig: EditorConfig = baseEditorConfig

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
          featureBeforeEditor={featureBeforeEditor}
          featureAfterEditor={featureAfterEditor}
          featureChildren={featureChildren}
          // Ensure React fully remounts when instanceKey changes
          key={fieldId}
        />
        {fieldError && <ErrorText id={`${field.name}-error`} text={fieldError} />}
      </div>
    </div>
  )
}
