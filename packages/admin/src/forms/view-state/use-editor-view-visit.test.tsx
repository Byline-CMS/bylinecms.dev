/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act, type ReactNode, StrictMode } from 'react'

import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import { useEditorViewVisit } from './use-editor-view-visit.js'
import type { EditorViewStateStore } from './editor-view-state.js'

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
actGlobal.IS_REACT_ACT_ENVIRONMENT = true

// `@testing-library/react` is not a dependency of this package, so this is a
// minimal renderHook built on `createRoot` and `act`.
function renderHook(
  initialId: string,
  options: { wrapper?: (props: { children: ReactNode }) => ReactNode } = {}
) {
  const container = document.createElement('div')
  const root = createRoot(container)
  const current: { store: EditorViewStateStore | null } = { store: null }
  function Probe({ id }: { id: string }) {
    current.store = useEditorViewVisit(id)
    return null
  }
  const render = (id: string) =>
    act(() => {
      const probe = <Probe id={id} />
      root.render(options.wrapper ? options.wrapper({ children: probe }) : probe)
    })
  render(initialId)
  return {
    result: current,
    rerender: render,
    unmount: () => act(() => root.unmount()),
  }
}

describe('useEditorViewVisit', () => {
  it('returns the same store while the identity is unchanged', () => {
    const { result, rerender } = renderHook('collection/docs/1')
    const first = result.store
    rerender('collection/docs/1')
    expect(result.store).toBe(first)
  })

  it('returns a new store when the identity changes', () => {
    const { result, rerender } = renderHook('collection/docs/1')
    const first = result.store
    rerender('collection/docs/2')
    expect(result.store).not.toBe(first)
  })

  it('settles on one store per identity under StrictMode', () => {
    const { result, rerender } = renderHook('collection/docs/1', {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    })
    const first = result.store
    rerender('collection/docs/1')
    expect(result.store).toBe(first)
    rerender('collection/docs/2')
    const second = result.store
    expect(second).not.toBe(first)
    rerender('collection/docs/2')
    expect(result.store).toBe(second)
  })
})
