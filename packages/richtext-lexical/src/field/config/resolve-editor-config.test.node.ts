/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { defaultEditorConfig } from './default'
import { resolveEditorConfig } from './resolve-editor-config'
import type { EditorConfig } from './types'

/**
 * Minimal stand-in for an ExtensionsList — resolveEditorConfig only passes
 * the reference through, so identity is all these tests need.
 */
const fakeExtensions = { items: ['ext-a', 'ext-b'] } as unknown as NonNullable<
  EditorConfig['extensions']
>

function clone(config: EditorConfig): EditorConfig {
  return structuredClone(config)
}

describe('resolveEditorConfig', () => {
  it('returns the registered config as-is when the field carries none', () => {
    const registered = { ...clone(defaultEditorConfig), extensions: fakeExtensions }
    expect(resolveEditorConfig(undefined, registered)).toBe(registered)
  })

  it('field settings win per-key; unspecified registered settings survive', () => {
    const registered = clone(defaultEditorConfig)
    registered.settings.controls.markdownToggle = true
    registered.settings.placeholderText = 'registered placeholder'

    const fieldConfig = clone(defaultEditorConfig)
    fieldConfig.settings.controls.blockFormat = false
    fieldConfig.settings.controls.undoRedo = false

    const resolved = resolveEditorConfig(fieldConfig, registered)
    // Field's flags applied…
    expect(resolved.settings.controls.blockFormat).toBe(false)
    expect(resolved.settings.controls.undoRedo).toBe(false)
    // …and since schema-side configs are complete objects, its values win
    // for every key it carries (markdownToggle false from the default seed).
    expect(resolved.settings.controls.markdownToggle).toBe(false)
    expect(resolved.settings.placeholderText).toBe(fieldConfig.settings.placeholderText)
  })

  it('merges controls per-key so a partial override keeps the rest', () => {
    const registered = clone(defaultEditorConfig)
    const fieldConfig = {
      settings: { controls: { blockFormat: false } },
    } as unknown as typeof registered

    const resolved = resolveEditorConfig(fieldConfig, registered)
    expect(resolved.settings.controls.blockFormat).toBe(false)
    // Untouched controls keep the registered layer's values rather than
    // being wiped by a partial object.
    expect(resolved.settings.controls.undoRedo).toBe(true)
    expect(resolved.settings.controls.inlineCode).toBe(true)
    expect(resolved.settings.mode).toBe('richText')
    expect(resolved.settings.markdownShortcuts).toBe(false)
  })

  it('no longer carries an options record', () => {
    const registered = clone(defaultEditorConfig)
    expect('options' in registered.settings).toBe(false)
  })

  it('REGRESSION: a schema-side settings-only config must not discard the registered extensions graph', () => {
    // Before the merge existed, `field.editorConfig ?? registered` replaced
    // the whole object: a compact/minimal settings preset baked into the
    // schema silently dropped registration-time extension changes (removed
    // Insert-menu extensions, an added AI extension) and the editor fell
    // back to the built-in list.
    const registered = { ...clone(defaultEditorConfig), extensions: fakeExtensions }
    const fieldConfig = clone(defaultEditorConfig) // settings-only, no extensions

    const resolved = resolveEditorConfig(fieldConfig, registered)
    expect(resolved.extensions).toBe(fakeExtensions)
  })

  it('a field-carried extensions graph (advanced/manual) still wins', () => {
    const fieldExtensions = { items: ['field-ext'] } as unknown as NonNullable<
      EditorConfig['extensions']
    >
    const registered = { ...clone(defaultEditorConfig), extensions: fakeExtensions }
    const fieldConfig = { ...clone(defaultEditorConfig), extensions: fieldExtensions }

    const resolved = resolveEditorConfig(fieldConfig, registered)
    expect(resolved.extensions).toBe(fieldExtensions)
  })

  it('lexical config: field wins when present, registered otherwise', () => {
    const registered = clone(defaultEditorConfig)
    const fieldConfig = clone(defaultEditorConfig)

    const withField = resolveEditorConfig(fieldConfig, registered)
    expect(withField.lexical).toBe(fieldConfig.lexical)

    const withoutFieldLexical = resolveEditorConfig(
      { settings: fieldConfig.settings } as EditorConfig,
      registered
    )
    expect(withoutFieldLexical.lexical).toBe(registered.lexical)
  })

  it('does not mutate either input', () => {
    const registered = { ...clone(defaultEditorConfig), extensions: fakeExtensions }
    const fieldConfig = clone(defaultEditorConfig)
    const registeredSnapshot = JSON.stringify({ ...registered, extensions: undefined })
    const fieldSnapshot = JSON.stringify(fieldConfig)

    resolveEditorConfig(fieldConfig, registered)

    expect(JSON.stringify({ ...registered, extensions: undefined })).toBe(registeredSnapshot)
    expect(JSON.stringify(fieldConfig)).toBe(fieldSnapshot)
  })
})
