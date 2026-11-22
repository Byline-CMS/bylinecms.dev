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
