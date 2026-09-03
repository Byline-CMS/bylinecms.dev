/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { BylineFieldServicesProvider } from '@byline/admin/react'
import { defineAdminConfig, defineSingleton, type SingletonDefinition } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  invalidate: vi.fn(async () => {}),
  toast: vi.fn(),
  guardStates: [] as boolean[],
  update: vi.fn(),
  changeStatus: vi.fn(),
  unpublish: vi.fn(),
  schedule: vi.fn(),
  confirmSchedule: vi.fn(),
  cancelSchedule: vi.fn(),
  copyToLocale: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
}))

vi.mock('../chrome/loose-router.js', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('../collections/tanstack-navigation-guard.js', () => ({
  useTanStackNavigationGuard: (shouldBlock: boolean) => {
    mocks.guardStates.push(shouldBlock)
    return { isBlocked: false, stay: () => {}, proceed: () => {} }
  },
}))

vi.mock('../../server-fns/singletons/index.js', () => ({
  updateSingleton: mocks.update,
  changeSingletonStatus: mocks.changeStatus,
  unpublishSingleton: mocks.unpublish,
  scheduleSingletonPublish: mocks.schedule,
  confirmSingletonScheduledPublish: mocks.confirmSchedule,
  cancelSingletonScheduledPublish: mocks.cancelSchedule,
  copySingletonToLocale: mocks.copyToLocale,
}))

vi.mock('../../server-fns/collections/index.js', () => ({
  hasCommittedDocumentHookFailure: (result: unknown) =>
    typeof result === 'object' &&
    result != null &&
    'status' in result &&
    result.status === 'committed-hook-failed',
}))

vi.mock('../../server-fns/preview/index.js', () => ({
  enablePreviewModeFn: vi.fn(async () => {}),
}))

vi.mock('@byline/ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const Pass = ({ children }: any) => <div>{children}</div>
  const Modal: any = ({ children, isOpen }: any) => (isOpen ? <div>{children}</div> : null)
  Modal.Container = Pass
  Modal.Header = Pass
  Modal.Content = Pass
  Modal.Actions = Pass
  return {
    ...actual,
    useToastManager: () => ({ add: mocks.toast }),
    Dropdown: {
      Root: Pass,
      Trigger: ({ children }: any) => <div data-testid="actions-trigger">{children}</div>,
      Portal: Pass,
      Content: Pass,
      Item: ({ children, onClick }: any) => (
        <div onClick={onClick} onKeyDown={() => {}} role="menuitem" tabIndex={0}>
          {children}
        </div>
      ),
      Separator: () => <hr />,
    },
    Modal,
    Input: ({ name, value, onChange }: any) => (
      <input name={name} value={value ?? ''} onChange={onChange} />
    ),
    Label: ({ label, htmlFor, className }: any) => (
      <label htmlFor={htmlFor} className={className}>
        {label}
      </label>
    ),
    Select: ({ id, name, value, items, onValueChange, className }: any) => (
      <select
        id={id}
        name={name}
        value={value}
        className={className}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {items.map((item: { value: string; label: string }) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    ),
  }
})

import { SingletonView } from './view.js'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const singleton = defineSingleton({
  path: 'site-settings',
  label: 'Site settings',
  fields: [
    { name: 'title', label: 'Title', type: 'text', defaultValue: 'Default title' },
    {
      name: 'attachment',
      label: 'Attachment',
      type: 'file',
      optional: true,
      upload: { requireSavedDocument: true },
    },
  ],
}) satisfies SingletonDefinition

const adminConfig = {
  singleton: true as const,
  slug: singleton.path,
  preview: { url: () => '/preview-settings' },
}

const locales = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
]

const loadedDocument = {
  id: 'doc-settings',
  versionId: 'version-1',
  path: '__singleton__/site-settings',
  status: 'draft',
  fields: { title: 'Loaded title', attachment: null },
  _publishedVersion: {
    id: 'doc-settings',
    versionId: 'published-1',
    status: 'published',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  },
  _scheduledPublicationEnabled: true,
  _canSchedulePublication: true,
  _scheduledPublish: null,
}

const fieldServices = {
  getCollectionDocuments: async () => ({ docs: [], total: 0 }),
  uploadField: async () => ({}),
} as any

let container: HTMLDivElement
let root: Root

function view(
  currentDocument: typeof loadedDocument | null,
  locale = 'en',
  config: typeof adminConfig | { singleton: true; slug: string } = adminConfig
) {
  return (
    <I18nProvider
      bundle={adminTranslations({ locales: ['en'] })}
      activeLocale="en"
      defaultLocale="en"
      localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
    >
      <BylineFieldServicesProvider services={fieldServices}>
        <SingletonView
          singletonDefinition={singleton}
          adminConfig={config}
          document={currentDocument}
          initialData={currentDocument == null ? { title: 'Default title' } : undefined}
          locale={locale}
          contentLocales={locales}
          defaultContentLocale="en"
        />
      </BylineFieldServicesProvider>
    </I18nProvider>
  )
}

function render(
  currentDocument: typeof loadedDocument | null,
  locale = 'en',
  config: typeof adminConfig | { singleton: true; slug: string } = adminConfig
) {
  act(() => root.render(view(currentDocument, locale, config)))
}

function typeIntoTitle(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[name="title"]')
  if (input == null) throw new Error('title input not found')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit() {
  const form = container.querySelector('form')
  if (form == null) throw new Error('form not found')
  await act(async () => {
    form.requestSubmit()
  })
}

function latestToastDescription(): string {
  const call = mocks.toast.mock.calls.at(-1)?.[0] as { description?: string } | undefined
  return call?.description ?? ''
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.guardStates.length = 0
  mocks.update.mockResolvedValue({ versionId: 'version-next' })
  mocks.changeStatus.mockResolvedValue({ newStatus: 'published' })
  mocks.unpublish.mockResolvedValue({ archivedCount: 1 })
  mocks.schedule.mockResolvedValue({ state: 'armed' })
  mocks.confirmSchedule.mockResolvedValue({ state: 'armed' })
  mocks.cancelSchedule.mockResolvedValue(null)
  mocks.copyToLocale.mockResolvedValue({ versionId: 'version-next' })

  defineAdminConfig({
    routes: { admin: '/internal/cms' },
    collections: [singleton],
    admin: [adminConfig],
    slugifier: (value) => value.toLowerCase(),
    i18n: {
      admin: { defaultLocale: 'en', locales: ['en'] },
      content: {
        defaultLocale: 'en',
        locales: ['en', 'fr'],
        localeDefinitions: locales.map(({ code, label }) => ({ code, nativeName: label })),
      },
    },
  })

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SingletonView', () => {
  it('renders an unmaterialised slot with stable identity and no document-only affordances', () => {
    render(null)

    expect(container.querySelector('h1')?.textContent).toBe('Site settings')
    expect(container.textContent).not.toContain('Create Site settings')
    expect(container.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe(
      'Default title'
    )
    expect(container.querySelector('.byline-form-path')).toBeNull()
    expect(container.querySelector('[data-testid="actions-trigger"]')).toBeNull()
    expect(container.querySelector('.byline-view-menu')).toBeNull()
    expect(container.querySelector('.byline-preview-link')).toBeNull()
    expect(container.querySelector('.byline-form-actions-status-wrap')).toBeNull()
    expect(container.querySelector('[data-testid="upload-require-saved-document"]')).not.toBeNull()
  })

  it('reveals the inherited editor capabilities only after materialisation', () => {
    render(loadedDocument)

    expect(container.querySelector('.byline-view-menu')).not.toBeNull()
    expect(container.querySelector('select[name="contentLocale"]')).not.toBeNull()
    expect(container.querySelector('.byline-preview-link')).not.toBeNull()
    expect(container.querySelector('button[aria-label="History"]')).not.toBeNull()
    expect(container.querySelector('.byline-form-actions-status-wrap')).not.toBeNull()
    expect(container.querySelector('[data-testid="actions-trigger"]')).not.toBeNull()
    expect(container.textContent).toContain('Copy to Locale')
    expect(container.textContent).toContain('Schedule')
    expect(container.textContent).toContain('Unpublish')
    expect(container.querySelector('[data-testid="upload-require-saved-document"]')).toBeNull()
    expect(container.querySelector('.byline-field-file-upload')).not.toBeNull()
    expect(container.textContent).not.toContain('Delete')
    expect(container.textContent).not.toContain('Duplicate')
    expect(container.textContent).not.toContain('API')

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="History"]')?.click())
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/internal/cms/singletons/$singleton/history',
      params: { singleton: 'site-settings' },
      search: { locale: 'en' },
    })
  })

  it('never derives a singleton preview from its internal stored path', () => {
    render(loadedDocument, 'en', { singleton: true, slug: singleton.path })

    expect(container.querySelector('.byline-view-menu')).not.toBeNull()
    expect(container.querySelector('.byline-preview-link')).toBeNull()
  })

  it('saves full data with the active locale and the correct optimistic version', async () => {
    render(null, 'en')
    typeIntoTitle('First save')
    await submit()

    expect(mocks.update).toHaveBeenLastCalledWith({
      data: {
        singleton: 'site-settings',
        data: { title: 'First save', attachment: undefined },
        locale: 'en',
        expectedVersionId: undefined,
      },
    })
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    root = createRoot(container)
    render(loadedDocument, 'fr')
    typeIntoTitle('Second save')
    await submit()

    expect(mocks.update).toHaveBeenLastCalledWith({
      data: {
        singleton: 'site-settings',
        data: { title: 'Second save', attachment: null },
        locale: 'fr',
        expectedVersionId: 'version-1',
      },
    })
    expect(mocks.invalidate).toHaveBeenCalledTimes(2)
  })

  it('distinguishes stale saves from a singleton missing on the server', async () => {
    mocks.update.mockRejectedValueOnce({ code: 'ERR_CONFLICT' })
    render(loadedDocument)
    typeIntoTitle('Stale edit')
    await submit()
    const conflict = latestToastDescription()
    expect(conflict).toContain('Someone else saved this singleton first')

    act(() => root.unmount())
    root = createRoot(container)
    mocks.update.mockRejectedValueOnce({ code: 'ERR_NOT_FOUND' })
    render(loadedDocument)
    typeIntoTitle('Missing edit')
    await submit()
    const notConfigured = latestToastDescription()
    expect(notConfigured).toContain('not configured on the server')
    expect(notConfigured).not.toBe(conflict)
  })

  it('keeps a failed save dirty with the navigation guard active', async () => {
    mocks.update.mockRejectedValueOnce({ code: 'ERR_CONFLICT' })
    render(loadedDocument)
    typeIntoTitle('Unsaved change')
    await submit()

    expect(mocks.guardStates).toContain(true)
    expect(mocks.guardStates.at(-1)).toBe(true)
    expect(container.textContent).toContain('Cancel')
  })

  it('treats a committed afterSave failure as saved, warns, and reloads canonical state', async () => {
    mocks.update.mockResolvedValueOnce({
      status: 'committed-hook-failed',
      documentId: 'doc-settings',
      documentVersionId: 'version-next',
      sideEffectFailure: { phase: 'afterSave', code: 'ERR_UNHANDLED' },
    })
    render(loadedDocument)
    typeIntoTitle('Committed change')
    await submit()

    expect(latestToastDescription()).toContain(
      'Your changes were saved, but a post-save update failed'
    )
    expect(mocks.invalidate).toHaveBeenCalledOnce()
    expect(mocks.guardStates.at(-1)).toBe(false)
    expect(container.textContent).toContain('Close')
  })

  it('re-runs the loader and remounts before unlocking saved-document uploads', async () => {
    const loader = vi
      .fn<() => Promise<typeof loadedDocument | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(loadedDocument)

    render(await loader())
    expect(container.querySelector('[data-testid="upload-require-saved-document"]')).not.toBeNull()

    act(() => root.unmount())
    root = createRoot(container)
    render(await loader())
    expect(loader).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="upload-require-saved-document"]')).toBeNull()
    expect(container.querySelector('.byline-field-file-upload')).not.toBeNull()
  })

  it('closes to the admin dashboard rather than a collection list', () => {
    render(null)
    const close = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Close'
    )
    if (close == null) throw new Error('Close button not found')
    act(() => close.click())

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/internal/cms' })
  })
})
