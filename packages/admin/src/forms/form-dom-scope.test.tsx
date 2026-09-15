/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FormProvider } from './form-context'
import { useFormDomScope, useScopedDomId } from './form-dom-scope'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('form DOM scope', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  const render = (node: React.ReactNode) => {
    act(() => {
      root.render(node)
    })
  }

  it('gives two concurrently mounted providers different scopes', () => {
    const scopes: string[] = []
    const Probe = () => {
      scopes.push(useFormDomScope())
      return null
    }

    render(
      <>
        <FormProvider initialData={{}}>
          <Probe />
        </FormProvider>
        <FormProvider initialData={{}}>
          <Probe />
        </FormProvider>
      </>
    )

    expect(scopes).toHaveLength(2)
    expect(new Set(scopes).size).toBe(2)
  })

  it('derives a stable id for the same base across re-renders', () => {
    const seen: string[] = []
    const Probe = () => {
      seen.push(useScopedDomId('title'))
      return null
    }

    render(
      <FormProvider initialData={{}}>
        <Probe />
      </FormProvider>
    )
    render(
      <FormProvider initialData={{}}>
        <Probe />
      </FormProvider>
    )

    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(new Set(seen).size).toBe(1)
  })

  it('scopes the base so two forms derive different ids from one field name', () => {
    const ids: string[] = []
    const Probe = () => {
      ids.push(useScopedDomId('title'))
      return null
    }

    render(
      <>
        <FormProvider initialData={{}}>
          <Probe />
        </FormProvider>
        <FormProvider initialData={{}}>
          <Probe />
        </FormProvider>
      </>
    )

    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(id.endsWith('title')).toBe(true)
  })

  it('returns a caller-supplied id unchanged rather than scoping it twice', () => {
    let derived = ''
    const Probe = () => {
      derived = useScopedDomId('title', 'explicit-id')
      return null
    }

    render(
      <FormProvider initialData={{}}>
        <Probe />
      </FormProvider>
    )

    expect(derived).toBe('explicit-id')
  })

  /**
   * Field widgets render outside a form provider in places — the admin user and
   * role screens compose them directly — so the hook has to degrade to the bare
   * base rather than throw or invent a scope.
   */
  it('falls back to the bare base outside a provider', () => {
    let derived = ''
    let scope = 'unset'
    const Probe = () => {
      scope = useFormDomScope()
      derived = useScopedDomId('title')
      return null
    }

    render(<Probe />)

    expect(scope).toBe('')
    expect(derived).toBe('title')
  })

  /**
   * `useId` is the only source that agrees between the server render and
   * hydration. A counter or a random value would differ, React would discard the
   * server-rendered attributes, and every `for`/`aria-labelledby` pairing written
   * during SSR would silently point at an id that no longer exists.
   */
  it('derives the scope from React useId, so ids survive hydration', () => {
    const scopes: string[] = []
    const Probe = () => {
      scopes.push(useFormDomScope())
      return null
    }

    render(
      <FormProvider initialData={{}}>
        <Probe />
      </FormProvider>
    )

    expect(scopes[0]).not.toBe('')
    // React 19 brackets its generated ids; the exact spelling is React's to
    // choose, so assert the shape rather than the characters.
    expect(scopes[0]).toMatch(/[^a-zA-Z0-9]/)
  })
})
