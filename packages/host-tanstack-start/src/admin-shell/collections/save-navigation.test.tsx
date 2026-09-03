/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { act } from 'react'

import { type MultiCollectionDefinition, SINGLE_STATUS_WORKFLOW } from '@byline/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  navigate: vi.fn(),
  formProps: [] as Array<Record<string, unknown>>,
  toastAdd: vi.fn(),
  update: vi.fn(),
  updateSystemFields: vi.fn(),
}))

vi.mock('@byline/admin/react', () => ({
  FormRenderer: (props: Record<string, unknown>) => {
    mocks.formProps.push(props)
    return <div data-testid="form-renderer" />
  },
}))

vi.mock('@byline/i18n/react', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@byline/ui/react', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return {
    Container: Pass,
    Section: Pass,
    useToastManager: () => ({ add: mocks.toastAdd }),
  }
})

vi.mock('../../routes/admin-path.js', () => ({
  getAdminRoutePath: (...parts: string[]) => `/admin/${parts.join('/')}`,
}))

vi.mock('../../routes/list-return-state.js', () => ({
  decodeListReturnState: () => ({ page: 2 }),
}))

vi.mock('../../routes/list-return-storage.js', () => ({
  clearListReturnState: vi.fn(),
}))

vi.mock('../../server-fns/collections/index.js', () => ({
  cancelCollectionDocumentScheduledPublish: vi.fn(),
  confirmCollectionDocumentScheduledPublish: vi.fn(),
  copyDocumentToLocale: vi.fn(),
  createCollectionDocument: mocks.create,
  deleteDocument: vi.fn(),
  deleteDocumentLocale: vi.fn(),
  duplicateCollectionDocument: vi.fn(),
  hasCommittedDocumentHookFailure: (result: { status: string }) =>
    result.status === 'committed-hook-failed',
  hasDeleteSideEffectFailures: () => false,
  scheduleCollectionDocumentPublish: vi.fn(),
  unpublishDocument: vi.fn(),
  updateCollectionDocumentSystemFields: mocks.updateSystemFields,
  updateCollectionDocumentWithPatches: mocks.update,
  updateDocumentStatus: vi.fn(),
}))

vi.mock('../chrome/loose-router.js', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('./tanstack-navigation-guard.js', () => ({
  useTanStackNavigationGuard: () => ({
    isBlocked: false,
    stay: () => {},
    proceed: () => {},
  }),
}))

vi.mock('./view-menu.js', () => ({
  ViewMenu: () => null,
}))

import { CreateView } from './create.js'
import { EditView } from './edit.js'

const collection = {
  path: 'languages',
  labels: { singular: 'Language', plural: 'Languages' },
  workflow: SINGLE_STATUS_WORKFLOW,
  fields: [{ name: 'name', label: 'Name', type: 'text' }],
} as MultiCollectionDefinition

const initialData = {
  id: 'language-en',
  versionId: 'version-1',
  status: 'published',
  fields: { name: 'English' },
}

let container: HTMLDivElement
let root: Root

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.formProps.length = 0
  mocks.create.mockResolvedValue({
    status: 'ok',
    documentId: 'language-th',
    documentVersionId: 'version-created',
  })
  mocks.update.mockResolvedValue({ status: 'ok' })
  mocks.updateSystemFields.mockResolvedValue({ status: 'ok' })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

afterAll(() => {
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT
})

function latestSubmit(): (payload: Record<string, unknown>) => Promise<void> {
  const onSubmit = mocks.formProps.at(-1)?.onSubmit
  if (typeof onSubmit !== 'function') throw new Error('FormRenderer onSubmit not found')
  return onSubmit as (payload: Record<string, unknown>) => Promise<void>
}

describe('collection post-save navigation', () => {
  it('bypasses the dirty-form blocker when create redirects to the new document', async () => {
    act(() => {
      root.render(<CreateView collectionDefinition={collection} from="page=2" />)
    })

    await act(async () => {
      await latestSubmit()({ data: { name: 'Thai' } })
    })

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/collections/$collection/$id',
      params: { collection: 'languages', id: 'language-th' },
      search: { action: 'created', from: 'page=2' },
      ignoreBlocker: true,
    })
  })

  it('bypasses the dirty-form blocker when create falls back to the list', async () => {
    mocks.create.mockResolvedValueOnce({ status: 'ok' })
    act(() => {
      root.render(<CreateView collectionDefinition={collection} from="page=2" />)
    })

    await act(async () => {
      await latestSubmit()({ data: { name: 'Thai' } })
    })

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/collections/$collection',
      params: { collection: 'languages' },
      search: { page: 2, action: 'created' },
      ignoreBlocker: true,
    })
  })

  it('does not bypass the blocker or navigate when create fails', async () => {
    const error = new Error('create failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.create.mockRejectedValueOnce(error)
    act(() => {
      root.render(<CreateView collectionDefinition={collection} />)
    })

    await expect(latestSubmit()({ data: { name: 'Thai' } })).rejects.toBe(error)

    expect(mocks.navigate).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('treats a committed create hook failure as saved and navigates with a warning', async () => {
    mocks.create.mockResolvedValueOnce({
      status: 'committed-hook-failed',
      documentId: 'language-th',
      documentVersionId: 'version-created',
      sideEffectFailure: { phase: 'afterCreate', code: 'ERR_UNHANDLED' },
    })
    act(() => {
      root.render(<CreateView collectionDefinition={collection} from="page=2" />)
    })

    await act(async () => {
      await latestSubmit()({ data: { name: 'Thai' } })
    })

    expect(mocks.toastAdd).toHaveBeenCalledWith({
      title: 'collections.save.hookFailedToast',
      description: 'collections.save.hookFailedDescription',
      data: { intent: 'warning', iconType: 'warning', icon: true, close: true },
    })
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/collections/$collection/$id',
      params: { collection: 'languages', id: 'language-th' },
      search: { from: 'page=2' },
      ignoreBlocker: true,
    })
  })

  it('bypasses the dirty-form blocker during the successful edit refresh', async () => {
    act(() => {
      root.render(
        <EditView
          collectionDefinition={collection}
          initialData={initialData as never}
          contentLocales={[{ code: 'en', label: 'English' }]}
          defaultContentLocale="en"
          locale="en"
        />
      )
    })

    await act(async () => {
      await latestSubmit()({
        data: { name: 'English' },
        patches: [{ kind: 'field.set', path: 'name', value: 'English' }],
        contentDirty: true,
        pathDirty: false,
        availableLocalesDirty: false,
      })
    })

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/collections/$collection/$id',
      params: { collection: 'languages', id: 'language-en' },
      search: expect.any(Function),
      ignoreBlocker: true,
    })
  })

  it('treats a committed update hook failure as saved and refreshes with a warning', async () => {
    mocks.update.mockResolvedValueOnce({
      status: 'committed-hook-failed',
      documentId: 'language-en',
      documentVersionId: 'version-2',
      sideEffectFailure: { phase: 'afterUpdate', code: 'ERR_UNHANDLED' },
    })
    act(() => {
      root.render(
        <EditView
          collectionDefinition={collection}
          initialData={initialData as never}
          contentLocales={[{ code: 'en', label: 'English' }]}
          defaultContentLocale="en"
          locale="en"
        />
      )
    })

    await act(async () => {
      await latestSubmit()({
        data: { name: 'English' },
        patches: [{ kind: 'field.set', path: 'name', value: 'English' }],
        contentDirty: true,
        pathDirty: false,
        availableLocalesDirty: false,
      })
    })

    expect(mocks.toastAdd).toHaveBeenCalledWith({
      title: 'collections.save.hookFailedToast',
      description: 'collections.save.hookFailedDescription',
      data: { intent: 'warning', iconType: 'warning', icon: true, close: true },
    })
    expect(mocks.navigate).toHaveBeenCalledWith(expect.objectContaining({ ignoreBlocker: true }))
  })
})
