/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Lightweight uikit stubs — we don't care about the visual rendering, only
// that the Input forwards props and the Label renders its htmlFor.
vi.mock('@infonomic/uikit/react', () => ({
  Label: ({ id, htmlFor, label }: { id?: string; htmlFor?: string; label?: string }) => (
    <label id={id} htmlFor={htmlFor}>
      {label}
    </label>
  ),
  Input: ({
    id,
    name,
    value,
    placeholder,
    onChange,
    helpText,
    ...rest
  }: {
    id?: string
    name?: string
    value?: string
    placeholder?: string
    onChange?: (e: { target: { value: string } }) => void
    helpText?: string
    [key: string]: any
  }) => (
    <>
      <input
        id={id}
        name={name}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={onChange}
        {...rest}
      />
      {helpText ? <span data-testid="help-text">{helpText}</span> : null}
    </>
  ),
}))

// Mutable mocks controlled per-test via the setFixture helper below.
const fixture: {
  systemPath: string | null
  sourceValue: unknown
  setSystemPath: ReturnType<typeof vi.fn>
} = {
  systemPath: null,
  sourceValue: '',
  setSystemPath: vi.fn(),
}

vi.mock('./form-context', () => ({
  useFormContext: () => ({ setSystemPath: fixture.setSystemPath }),
  useSystemPath: () => fixture.systemPath,
  useFieldValue: () => fixture.sourceValue,
}))

// Import AFTER the mocks so PathWidget picks them up.
// biome-ignore lint/correctness/useImportExtensions: webapp TS resolves via tsconfig paths
import { PathWidget } from './path-widget'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

interface Fixture {
  systemPath?: string | null
  sourceValue?: unknown
}

function setFixture(next: Fixture = {}) {
  fixture.systemPath = next.systemPath ?? null
  fixture.sourceValue = next.sourceValue ?? ''
  fixture.setSystemPath = vi.fn()
}

describe('PathWidget', () => {
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

  const render = (
    props: Partial<{
      useAsPath: string | undefined
      mode: 'create' | 'edit'
    }> = {}
  ) => {
    act(() => {
      root.render(
        <PathWidget
          useAsPath={props.useAsPath ?? 'title'}
          collectionPath="pages"
          defaultLocale="en"
          mode={props.mode ?? 'create'}
        />
      )
    })
  }

  const getInput = () => container.querySelector('#system-path') as HTMLInputElement

  it('shows the live-derived preview as placeholder when creating with an empty override', () => {
    setFixture({ systemPath: null, sourceValue: 'Hello World' })
    render({ mode: 'create' })

    const input = getInput()
    expect(input).toBeTruthy()
    expect(input.value).toBe('')
    expect(input.getAttribute('placeholder')).toBe('Will be saved as "hello-world"')
  })

  it('shows the persisted path in edit mode (no placeholder preview)', () => {
    setFixture({ systemPath: 'existing-path', sourceValue: 'Hello World' })
    render({ mode: 'edit' })

    const input = getInput()
    expect(input.value).toBe('existing-path')
    // livePreview === 'hello-world' differs from persisted 'existing-path',
    // so the regenerate button is rendered.
    const regenerate = container.querySelector('button')
    expect(regenerate).toBeTruthy()
    expect(regenerate?.textContent).toContain('Regenerate from title')
  })

  it('"Regenerate" writes the live preview into the systemPath slot', () => {
    setFixture({ systemPath: 'stale-path', sourceValue: 'Brand New Title' })
    render({ mode: 'edit' })

    const regenerate = container.querySelector('button') as HTMLButtonElement
    expect(regenerate).toBeTruthy()

    act(() => {
      regenerate.click()
    })

    expect(fixture.setSystemPath).toHaveBeenCalledWith('brand-new-title')
  })

  it('clearing the input reverts the slot to null (sticky-from-previous)', () => {
    setFixture({ systemPath: 'my-path', sourceValue: 'My Path' })
    render({ mode: 'edit' })

    const input = getInput()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(fixture.setSystemPath).toHaveBeenCalledWith(null)
  })

  it('typing a non-empty value writes a string override', () => {
    setFixture({ systemPath: null, sourceValue: 'Anything' })
    render({ mode: 'create' })

    const input = getInput()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(input, 'custom-slug')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(fixture.setSystemPath).toHaveBeenCalledWith('custom-slug')
  })

  it('links the input to an sr-only description via aria-describedby', () => {
    setFixture({ systemPath: null, sourceValue: 'Hi' })
    render({ mode: 'create' })

    const input = getInput()
    expect(input.getAttribute('aria-describedby')).toBe('system-path-description')
    const description = container.querySelector('#system-path-description')
    expect(description).toBeTruthy()
    expect(description?.textContent).toContain('System-managed URL path')
  })

  it('does not render the Regenerate button when livePreview equals systemPath', () => {
    setFixture({ systemPath: 'hello-world', sourceValue: 'Hello World' })
    render({ mode: 'edit' })
    expect(container.querySelector('button')).toBeNull()
  })

  it('does not render the Regenerate button when there is no useAsPath', () => {
    setFixture({ systemPath: 'whatever', sourceValue: '' })
    render({ mode: 'edit', useAsPath: undefined })
    expect(container.querySelector('button')).toBeNull()
  })
})
