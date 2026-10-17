/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ComponentProps, ReactNode } from 'react'
import { act } from 'react'

import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ toast: vi.fn(), writeText: vi.fn() }))
vi.mock('@byline/ui/react', () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Section: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  IconButton: ({
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<'button'> & {
    size?: string
    variant?: string
  }) => <button {...props} />,
  Tooltip: ({ children }: { children: ReactNode }) => children,
  CopyIcon: () => null,
  DownloadIcon: () => null,
  useToastManager: () => ({ add: mocks.toast }),
}))
vi.mock('./view-menu.js', () => ({
  ViewMenu: ({ dataActions }: { dataActions?: ReactNode }) => <div>{dataActions}</div>,
}))

import { ApiView } from './api.js'

const payload = {
  id: 'document-1',
  fields: {
    title: 'Sample document',
    content: [{ _type: 'text', children: [{ text: 'Hidden nested content' }] }],
    related: { fields: { title: 'Populated relation' } },
  },
} as ComponentProps<typeof ApiView>['initialData']

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const originalURL = globalThis.URL
const createObjectURL = vi.fn((_blob: Blob) => 'blob:test-json')
const revokeObjectURL = vi.fn()

// `locale: null` renders as a route without a locale search param.
function render(data = payload, locale: string | null = 'en', depth = 0) {
  act(() =>
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
      >
        <ApiView
          collectionDefinition={{
            path: 'docs',
            labels: { singular: 'Doc', plural: 'Docs' },
            fields: [],
          }}
          initialData={data}
          locale={locale ?? undefined}
          depth={depth}
          contentLocales={[
            { code: 'en', label: 'English' },
            { code: 'fr', label: 'French' },
          ]}
          defaultContentLocale="fr"
        />
      </I18nProvider>
    )
  )
}

async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found: ${label}`)
  await act(async () => button.click())
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'URL',
    Object.assign(class extends originalURL {}, { createObjectURL, revokeObjectURL })
  )
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.writeText } })
  mocks.writeText.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('API document exports', () => {
  it('copies the complete payload without expanding or mounting nested content', async () => {
    render()
    expect(container.textContent).not.toContain('Hidden nested content')
    await click('Copy JSON')
    expect(JSON.parse(mocks.writeText.mock.calls[0]?.[0])).toEqual(payload)
    expect(container.textContent).not.toContain('Hidden nested content')
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'JSON copied' }))
  })

  it('copies new data after a locale and population-depth reload', async () => {
    render()
    const reloaded = {
      ...payload,
      fields: { title: 'Français', related: { title: 'Relation française' } },
    }
    render(reloaded, 'fr', 2)
    await click('Copy JSON')
    expect(JSON.parse(mocks.writeText.mock.calls[0]?.[0])).toEqual(reloaded)
  })

  it('reports clipboard rejection without claiming success', async () => {
    mocks.writeText.mockRejectedValue(new Error('Permission denied'))
    render()
    await click('Copy JSON')
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not copy JSON. Try Download JSON.',
      })
    )
    expect(container.querySelector('button')?.disabled).toBe(false)
  })

  it('offers download when the clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    render()
    await click('Copy JSON')
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not copy JSON. Try Download JSON.',
      })
    )
    expect(mocks.writeText).not.toHaveBeenCalled()
  })

  it('names a download after the default locale when the route has none', async () => {
    vi.useFakeTimers()
    let filename = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      filename = this.download
    })
    render(payload, null)
    await click('Download JSON')
    expect(filename).toBe('docs-document-1-fr.json')
  })

  it('reports a download failure and releases the allocated URL', async () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('Download unavailable')
    })
    render()
    await click('Download JSON')
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not download JSON.',
      })
    )
    expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-json')
  })

  it('downloads complete current JSON and releases the temporary link and URL', async () => {
    vi.useFakeTimers()
    let filename = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      filename = this.download
      expect(this.isConnected).toBe(true)
      expect(this.href).toBe('blob:test-json')
    })
    render()
    const reloaded = { ...payload, fields: { title: 'Français', content: payload.fields.content } }
    render(reloaded, 'fr', 2)
    await click('Download JSON')
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    expect(blob.type).toBe('application/json;charset=utf-8')
    expect(filename).toBe('docs-document-1-fr-depth2.json')
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-json')
    vi.useRealTimers()
    expect(JSON.parse(await readBlob(blob))).toEqual(reloaded)
    expect(container.textContent).not.toContain('Hidden nested content')
  })
})
