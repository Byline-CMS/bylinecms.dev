/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  ArrayField as ArrayFieldType,
  BlocksField as BlocksFieldType,
  Field,
  FieldAdminConfig,
  FieldComponentSlots,
  GroupField as GroupFieldType,
  RichTextEditorComponent,
} from '@byline/core'
import { getClientConfig } from '@byline/core'
import cx from 'classnames'

import { useFormContext } from '../forms/form-context'
import { ArrayField } from './array/array-field'
import { BlocksField } from './blocks/blocks-field'
import { CheckboxField } from './checkbox/checkbox-field'
import { CodeField } from './code/code-field'
import { DateTimeField } from './datetime/datetime-field'
import styles from './field-renderer.module.css'
import { FileField } from './file/file-field'
import { GroupField } from './group/group-field'
import { ImageField } from './image/image-field'
import { LocaleBadge } from './locale-badge'
import { NumericalField } from './numerical/numerical-field'
import { RelationField } from './relation/relation-field'
import { RelationManyField } from './relation/relation-many-field'
import { SelectField } from './select/select-field'
import { TextField } from './text/text-field'
import { TextAreaField } from './text-area/text-area-field'
import { useFieldChangeHandler } from './use-field-change-handler'
import { useFieldCondition } from './use-field-condition'

// ---------------------------------------------------------------------------
// FieldRenderer — the main field type switch. Delegates to the appropriate
// field widget based on `field.type`.
// ---------------------------------------------------------------------------

interface FieldRendererProps {
  field: Field
  defaultValue?: any
  basePath?: string
  disableSorting?: boolean
  hideLabel?: boolean
  /** Collection path (e.g. `'media'`) forwarded to upload-capable fields. */
  collectionPath?: string
  /**
   * The active content locale (e.g. `'en'`, `'fr'`). When provided and
   * `field.localized === true`, a small locale badge is shown so the editor
   * knows they are working on a localised field in the current language.
   */
  contentLocale?: string
  /**
   * Optional UI component slot overrides from the admin config.
   * Forwarded to value-field widgets that support custom slots.
   */
  components?: FieldComponentSlots
  /**
   * Per-field rich-text editor component override from the admin config.
   * Takes precedence over the globally registered
   * `ClientConfig.fields.richText.editor` for this single field.
   * Ignored when `field.type !== 'richText'`.
   */
  editor?: RichTextEditorComponent
  /**
   * Admin overrides for this field's *descendants*, keyed by dotted,
   * index-free schema paths relative to this field ('answer',
   * 'filesGroup.publicationFile'). Only meaningful when `field` is a
   * structural `group` / `array` — the widget slices the map per child
   * (see `sliceFieldAdmin`). `components` / `editor` above stay the
   * overrides for this field itself.
   */
  fieldAdmin?: Record<string, FieldAdminConfig>
}

export const FieldRenderer = ({
  field,
  defaultValue: initialDefault,
  basePath,
  disableSorting,
  hideLabel,
  collectionPath,
  contentLocale,
  components,
  editor,
  fieldAdmin,
}: FieldRendererProps) => {
  const path = basePath ? `${basePath}.${field.name}` : field.name
  const htmlId = path.replace(/[[\].]/g, '-')

  const handleChange = useFieldChangeHandler(field, path)
  const { getFieldValue } = useFormContext()

  // Conditional visibility (BaseField.condition) — re-evaluated on every form
  // edit; the field unmounts while its condition is false.
  const visible = useFieldCondition(field, basePath)

  // Conditional fields unmount while hidden, so on re-show the uncontrolled
  // widget must be re-seeded from the live form store (which survives the
  // unmount) rather than the initial document data — otherwise an edit made
  // before hiding would be visually reverted while the store (and the patch
  // stream) still carried it. `undefined` means the path was never written,
  // in which case the initial default stands.
  const storedValue = field.condition ? getFieldValue(path) : undefined
  const defaultValue = storedValue !== undefined ? storedValue : initialDefault

  // When a locale is active and the field is localised, inject a badge into
  // the field label so the editor knows they are editing locale-specific content.
  const isLocalised = (field as any).localized === true

  const badge =
    isLocalised && contentLocale && !hideLabel ? <LocaleBadge locale={contentLocale} /> : null

  // All hooks have run by this point, so a conditional bail-out is safe.
  // Hiding retains the field's stored value — no clearing patch is emitted.
  if (!visible) return null

  /**
   * Render the underlying field widget. If the field is localised, we wrap it
   * so we can append the locale badge after the label.
   */
  const renderField = () => {
    switch (field.type) {
      case 'text':
        return (
          <TextField
            field={hideLabel ? { ...field, label: undefined } : field}
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            id={htmlId}
            locale={isLocalised ? contentLocale : undefined}
            components={components}
          />
        )
      case 'textArea':
        return (
          <TextAreaField
            field={hideLabel ? { ...field, label: undefined } : field}
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            id={htmlId}
            locale={isLocalised ? contentLocale : undefined}
            components={components}
          />
        )
      case 'code':
        return (
          <CodeField
            field={hideLabel ? { ...field, label: undefined } : field}
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            id={htmlId}
            locale={isLocalised ? contentLocale : undefined}
            components={components}
          />
        )
      case 'checkbox':
        return (
          <CheckboxField
            field={hideLabel ? { ...field, label: undefined } : field}
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            id={htmlId}
          />
        )
      case 'select':
        return (
          <SelectField
            field={hideLabel ? { ...field, label: undefined } : field}
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            id={htmlId}
          />
        )
      case 'richText': {
        // Admin-side per-field override takes precedence over the globally
        // registered editor (`ClientConfig.fields.richText.editor`). The
        // override travels via `FieldAdminConfig.fields.<name>.editor` —
        // see admin-types — so React component references stay out of the
        // schema graph that's loaded by the server bootstrap.
        const RichTextEditor = editor ?? getClientConfig().fields?.richText?.editor
        if (!RichTextEditor) {
          throw new Error(
            'No richText editor registered. Install @byline/richtext-lexical and set ' +
              '`fields.richText.editor` in your admin config.'
          )
        }
        return (
          <RichTextEditor
            field={hideLabel ? { ...field, label: undefined } : field}
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            instanceKey={htmlId}
            locale={isLocalised ? contentLocale : undefined}
          />
        )
      }
      case 'datetime':
        return (
          <DateTimeField
            field={hideLabel ? { ...field, label: undefined } : field}
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            id={htmlId}
          />
        )
      case 'integer':
      case 'float':
      case 'decimal':
        return (
          <NumericalField
            field={hideLabel ? { ...field, label: undefined } : field}
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            id={htmlId}
            components={components}
          />
        )
      case 'counter':
        // Counter values are allocator-assigned; force readOnly at the
        // renderer level so the widget is always non-editable regardless
        // of whether the developer set `field.readOnly` explicitly.
        return (
          <NumericalField
            field={
              hideLabel
                ? { ...field, label: undefined, readOnly: true }
                : { ...field, readOnly: true }
            }
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            id={htmlId}
            components={components}
          />
        )
      case 'file':
        return (
          <FileField
            field={hideLabel ? { ...field, label: undefined } : field}
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            collectionPath={collectionPath}
          />
        )
      case 'image':
        return (
          <ImageField
            field={hideLabel ? { ...field, label: undefined } : field}
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            collectionPath={collectionPath}
          />
        )
      case 'relation':
        if (field.hasMany) {
          return (
            <RelationManyField
              field={hideLabel ? { ...field, label: undefined } : field}
              defaultValue={defaultValue}
              path={path}
              id={htmlId}
            />
          )
        }
        return (
          <RelationField
            field={hideLabel ? { ...field, label: undefined } : field}
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            id={htmlId}
          />
        )
      case 'group':
        // Render a group field as a fixed-order inline field group.
        return (
          <GroupField
            field={
              hideLabel
                ? ({ ...field, label: undefined } as unknown as GroupFieldType)
                : (field as unknown as GroupFieldType)
            }
            defaultValue={defaultValue}
            path={path}
            disableSorting={disableSorting}
            collectionPath={collectionPath}
            contentLocale={contentLocale}
            fieldAdmin={fieldAdmin}
          />
        )
      case 'blocks':
        if (!field.blocks) return null
        return (
          <BlocksField
            field={field as unknown as BlocksFieldType}
            defaultValue={defaultValue}
            path={path}
            contentLocale={contentLocale}
          />
        )
      case 'array':
        if (!field.fields) return null
        return (
          <ArrayField
            field={field as unknown as ArrayFieldType}
            defaultValue={defaultValue}
            path={path}
            disableSorting={disableSorting}
            collectionPath={collectionPath}
            contentLocale={contentLocale}
            fieldAdmin={fieldAdmin}
          />
        )
      default:
        return null
    }
  }

  // text, textArea, and code render the badge inside their own Label row;
  // the outer wrapper is only needed for other field types.
  const selfBadge =
    field.type === 'text' ||
    field.type === 'textArea' ||
    field.type === 'code' ||
    field.type === 'richText'

  if (badge && !selfBadge) {
    return (
      <div className={cx('byline-field-localized-wrap', styles['localized-wrap'])}>
        {renderField()}
        <span className={cx('byline-field-localized-badge', styles['localized-badge'])}>
          {badge}
        </span>
      </div>
    )
  }

  return renderField()
}
