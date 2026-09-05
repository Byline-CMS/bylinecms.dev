/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { act } from 'react'

import {
  DEFAULT_WORKFLOW,
  ERR_DOCUMENT_STALE,
  ERR_LOCK_CONFLICT,
  type MultiCollectionDefinition,
  SINGLE_STATUS_WORKFLOW,
} from '@byline/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  deletion: vi.fn(),
  schedule: vi.fn(),
  confirm: vi.fn(),
  cancelSchedule: vi.fn(),
  unpublish: vi.fn(),
  copyToLocale: vi.fn(),
  create: vi.fn(),
  deleteLocale: vi.fn(),
  duplicate: vi.fn(),
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
  cancelCollectionDocumentScheduledPublish: mocks.cancelSchedule,
  confirmCollectionDocumentScheduledPublish: mocks.confirm,
  copyDocumentToLocale: mocks.copyToLocale,
  createCollectionDocument: mocks.create,
  deleteDocument: mocks.deletion,
  deleteDocumentLocale: mocks.deleteLocale,
  duplicateCollectionDocument: mocks.duplicate,
  hasCommittedDocumentHookFailure: (result: { status: string }) =>
    result.status === 'committed-hook-failed',
  hasDeleteSideEffectFailures: () => false,
  scheduleCollectionDocumentPublish: mocks.schedule,
  unpublishDocument: mocks.unpublish,
  updateCollectionDocumentSystemFields: mocks.updateSystemFields,
  updateCollectionDocumentWithPatches: mocks.update,
  updateDocumentStatus: mocks.status,
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
  revision: 7,
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
  mocks.update.mockResolvedValue({ status: 'ok', documentId: 'language-en', revision: 8 })
  mocks.updateSystemFields.mockResolvedValue({ status: 'ok' })
  mocks.copyToLocale.mockResolvedValue({
    documentId: 'language-en',
    documentVersionId: 'version-2',
    revision: 8,
    sourceLocale: 'en',
    targetLocale: 'th',
    fieldsUpdated: 1,
  })
  mocks.deleteLocale.mockResolvedValue({
    documentId: 'language-en',
    documentVersionId: 'version-2',
    revision: 8,
    locale: 'th',
  })
  mocks.duplicate.mockResolvedValue({
    documentId: 'language-copy',
    documentVersionId: 'version-copy',
    sourceDocumentId: 'language-en',
    newPath: 'english-copy',
    pathRetried: false,
  })
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

function latestAction(name: string): (...args: any[]) => Promise<void> {
  const action = mocks.formProps.at(-1)?.[name]
  if (typeof action !== 'function') throw new Error(`FormRenderer ${name} not found`)
  return action as (...args: any[]) => Promise<void>
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

  it('sends content and metadata in one save using the loaded revision', async () => {
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
    const patches = [{ kind: 'field.set', path: 'name', value: 'English' }]
    await act(async () => {
      await latestSubmit()({
        data: { name: 'English' },
        patches,
        contentDirty: true,
        pathDirty: true,
        systemPath: 'renamed',
        availableLocalesDirty: true,
        systemAvailableLocales: ['en', 'fr'],
      })
    })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      data: {
        collection: 'languages',
        id: 'language-en',
        expectedRevision: 7,
        patches,
        locale: 'en',
        path: 'renamed',
        availableLocales: ['en', 'fr'],
      },
    })
    expect(mocks.updateSystemFields).not.toHaveBeenCalled()
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
      revision: 8,
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

  it.each([
    {
      action: 'onDuplicate',
      invoke: () => latestAction('onDuplicate')(),
      mock: mocks.duplicate,
      phase: 'afterCreate',
      expectedSearch: expect.any(Function),
      expectedId: 'language-copy',
    },
    {
      action: 'onCopyToLocale',
      invoke: () => latestAction('onCopyToLocale')({ targetLocale: 'th', overwrite: false }),
      mock: mocks.copyToLocale,
      phase: 'afterUpdate',
      expectedSearch: expect.any(Function),
      expectedId: 'language-en',
    },
    {
      action: 'onDeleteLocale',
      invoke: () => latestAction('onDeleteLocale')({ targetLocale: 'th' }),
      mock: mocks.deleteLocale,
      phase: 'afterUpdate',
      expectedSearch: expect.any(Function),
      expectedId: 'language-en',
    },
  ])('treats committed $action hook failures as completed mutations', async (testCase) => {
    testCase.mock.mockResolvedValueOnce({
      status: 'committed-hook-failed',
      documentId: testCase.expectedId,
      documentVersionId: 'version-committed',
      revision: 8,
      sideEffectFailure: { phase: testCase.phase, code: 'ERR_UNHANDLED' },
    })
    act(() => {
      root.render(
        <EditView
          collectionDefinition={collection}
          initialData={initialData as never}
          contentLocales={[
            { code: 'en', label: 'English' },
            { code: 'th', label: 'Thai' },
          ]}
          defaultContentLocale="en"
          locale="en"
        />
      )
    })

    await act(testCase.invoke)

    expect(mocks.toastAdd).toHaveBeenCalledWith({
      title: 'collections.save.hookFailedToast',
      description: 'collections.save.hookFailedDescription',
      data: { intent: 'warning', iconType: 'warning', icon: true, close: true },
    })
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/collections/$collection/$id',
      params: { collection: 'languages', id: testCase.expectedId },
      search: testCase.expectedSearch,
    })
  })
})

describe('collection editor mutation lockout', () => {
  const stale = ERR_DOCUMENT_STALE({
    message: 'Test failure',
    details: {
      reason: 'revision_mismatch',
      documentId: 'language-en',
      expectedRevision: 7,
      currentRevision: 8,
    },
  })
  const opened = {
    ...initialData,
    _publishedVersion: initialData,
    status: 'draft',
    _scheduledPublicationEnabled: true,
    _canSchedulePublication: true,
    _scheduledPublish: { state: 'needs_reconfirm' },
  }
  const renderEditor = () =>
    act(() =>
      root.render(
        <EditView
          collectionDefinition={{ ...collection, workflow: DEFAULT_WORKFLOW }}
          initialData={opened as never}
          contentLocales={[
            { code: 'en', label: 'English' },
            { code: 'th', label: 'Thai' },
          ]}
          defaultContentLocale="en"
          locale="en"
        />
      )
    )
  const operations = [
    ['onSubmit', mocks.update, { patches: [], contentDirty: true }],
    ['onStatusChange', mocks.status, 'published'],
    ['onDelete', mocks.deletion, undefined],
    ['onDuplicate', mocks.duplicate, undefined],
    ['onCopyToLocale', mocks.copyToLocale, { targetLocale: 'th', overwrite: true }],
    ['onDeleteLocale', mocks.deleteLocale, { targetLocale: 'th' }],
    ['onUnpublish', mocks.unpublish, undefined],
    ['onSchedulePublication', mocks.schedule, { publishAt: '2030-01-01T00:00:00Z' }],
    ['onConfirmScheduledPublication', mocks.confirm, undefined],
    ['onCancelScheduledPublication', mocks.cancelSchedule, undefined],
  ] as const
  it.each(operations)(
    'blocks subsequent writes after %s reports stale',
    async (name, operation, argument) => {
      operation.mockRejectedValueOnce(stale)
      renderEditor()
      await act(async () => {
        await expect(latestAction(name)(argument)).rejects.toBe(stale)
      })
      expect(mocks.formProps.at(-1)).toMatchObject({
        mutationIssue: 'stale',
        mutationsBlocked: true,
        observedRevision: 7,
      })
      for (const [otherName, , otherArgument] of operations) {
        await act(async () => {
          await expect(latestAction(otherName)(otherArgument)).rejects.toBe(stale)
        })
      }
      expect(operations.reduce((total, [, mock]) => total + mock.mock.calls.length, 0)).toBe(1)
      expect(mocks.navigate).not.toHaveBeenCalled()
      expect(mocks.toastAdd).not.toHaveBeenCalled()
    }
  )
  it.each([
    ['onSubmit', mocks.update, { patches: [], contentDirty: true }],
    ['onDelete', mocks.deletion, undefined],
  ] as const)(
    'presents confirmed lock rollback safely for %s',
    async (name, operation, argument) => {
      const failure = ERR_LOCK_CONFLICT({
        message: 'raw InnoDB private SQL',
        details: { reason: 'lock_conflict', rolledBack: true, retryable: true },
      })
      operation.mockRejectedValueOnce(failure)
      renderEditor()
      await act(async () => {
        await expect(latestAction(name)(argument)).rejects.toBe(failure)
      })
      expect(mocks.formProps.at(-1)).toMatchObject({
        mutationIssue: 'lock',
        mutationsBlocked: true,
        observedRevision: 7,
      })
      expect(mocks.toastAdd).not.toHaveBeenCalled()
    }
  )
})
