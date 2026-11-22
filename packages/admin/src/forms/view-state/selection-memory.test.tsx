/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEditorViewStateStore } from './editor-view-state'
import { recordTextSelection, replaySelection } from './selection-memory'
import { targetMarker } from './target-markers'

/** A field marker holding one control, as a field widget renders it. */
const fieldWith = (control: HTMLInputElement) => {
  const marker = document.createElement('div')
  for (const [name, value] of Object.entries(targetMarker('count', 'field'))) {
    marker.setAttribute(name, value)
  }
  marker.append(control)
  document.body.append(marker)
  return marker
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('plain-field selection support', () => {
  it('number input: no selection call', () => {
    const input = document.createElement('input')
    input.type = 'number'
    input.value = '42'
    fieldWith(input)
    const store = createEditorViewStateStore()
    store.setTarget({ path: 'count', role: 'field', offset: 0 })

    // Recording reads nothing from a control without a selection.
    recordTextSelection(store, 'count', input)
    const first = store.beginSave()
    store.settleSave(first, 'success')
    expect(store.grantSelection(first, 'count')).toBeNull()

    // Even a recorded selection whose value matches is never applied to it.
    store.setTarget({ path: 'count', role: 'field', offset: 0 })
    store.setSelection('count', { kind: 'text', start: 1, end: 1, direction: 'none', value: '42' })
    const second = store.beginSave()
    store.settleSave(second, 'success')
    const setRange = vi.spyOn(input, 'setSelectionRange')
    input.focus()
    replaySelection(store, second, 'count', input)
    expect(setRange).not.toHaveBeenCalled()
  })

  it('plain field: the store keeps a fingerprint of the value, never the value', () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.value = 'a secret value'
    fieldWith(input)
    input.setSelectionRange(2, 2)
    const store = createEditorViewStateStore()
    store.setTarget({ path: 'count', role: 'field', offset: 0 })
    recordTextSelection(store, 'count', input)
    const n = store.beginSave()
    store.settleSave(n, 'success')
    store.grantSelection(n, 'count')
    const record = store.takeSelection('count')
    expect(record).toMatchObject({ kind: 'text', start: 2, end: 2 })
    expect(Object.keys(record ?? {}).sort()).toEqual(
      ['direction', 'end', 'fingerprint', 'kind', 'start'].sort()
    )
    expect(JSON.stringify(record)).not.toContain('secret')
  })
})

describe('plain-field selection lifetime', () => {
  const textInput = (value: string) => {
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    return input
  }

  /** Spies on reads of `input.value` from here on. */
  const spyOnValue = (input: HTMLInputElement) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    const read = vi.fn(() => descriptor?.get?.call(input))
    Object.defineProperty(input, 'value', { configurable: true, get: read })
    return read
  }

  it('the control leaves the document before a save: it is never read and no caret is granted', () => {
    const input = textInput('Hello world')
    const marker = fieldWith(input)
    input.setSelectionRange(5, 5)
    const store = createEditorViewStateStore()
    store.setTarget({ path: 'count', role: 'field', offset: 0 })
    recordTextSelection(store, 'count', input)

    // The field disappears (a condition, a tab change) with no replacement.
    marker.remove()
    const read = spyOnValue(input)
    const saveSeq = store.beginSave()
    store.settleSave(saveSeq, 'success')
    expect(read).not.toHaveBeenCalled()
    expect(store.grantSelection(saveSeq, 'count')).toBeNull()
  })

  it('a selection snapshotted by a successful save survives the old control unmounting and reaches the new one', () => {
    const old = textInput('Hello world')
    const oldMarker = fieldWith(old)
    old.setSelectionRange(5, 5)
    const store = createEditorViewStateStore()
    store.setTarget({ path: 'count', role: 'field', offset: 0 })
    recordTextSelection(store, 'count', old)
    const saveSeq = store.beginSave()
    oldMarker.remove()
    store.settleSave(saveSeq, 'success')

    const replacement = textInput('Hello world')
    fieldWith(replacement)
    replacement.focus()
    replacement.setSelectionRange(0, 0)
    replaySelection(store, saveSeq, 'count', replacement)
    expect([replacement.selectionStart, replacement.selectionEnd]).toEqual([5, 5])

    // The replayed caret belongs to the new control: a second save with no
    // caret move restores it again, without reading the old control.
    const read = spyOnValue(old)
    const second = store.beginSave()
    store.settleSave(second, 'success')
    expect(read).not.toHaveBeenCalled()
    expect(store.grantSelection(second, 'count')).not.toBeNull()
    expect(store.takeSelection('count')).toMatchObject({ kind: 'text', start: 5, end: 5 })
  })

  it("an older control's removal leaves a newer control's selection in place", () => {
    const store = createEditorViewStateStore()
    store.setTarget({ path: 'count', role: 'field', offset: 0 })
    const old = textInput('Hello world')
    const oldMarker = fieldWith(old)
    old.setSelectionRange(5, 5)
    recordTextSelection(store, 'count', old)

    const newer = textInput('Hello world')
    fieldWith(newer)
    newer.setSelectionRange(2, 2)
    recordTextSelection(store, 'count', newer)
    oldMarker.remove()

    const saveSeq = store.beginSave()
    store.settleSave(saveSeq, 'success')
    expect(store.grantSelection(saveSeq, 'count')).not.toBeNull()
    expect(store.takeSelection('count')).toMatchObject({ kind: 'text', start: 2, end: 2 })
  })
})
