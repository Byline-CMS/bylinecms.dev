/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { act } from 'react'

import type { MultiCollectionDefinition, SingletonDefinition } from '@byline/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  invalidate: vi.fn(async () => {}),
  restoreSingleton: vi.fn(async () => ({})),
  restoreCollection: vi.fn(async () => ({})),
  findSingletonByVersion: vi.fn(async () => ({})),
  pagerProps: [] as Array<{ componentName: string; page: number; count: number }>,
  diffModalProps: [] as Array<Record<string, unknown>>,
  toast: vi.fn(),
  location: {
    pathname: '/admin/singletons/site-settings/history',
    search: {} as Record<string, unknown>,
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: mocks.location }),
  useParams: () => ({ collection: 'articles', id: 'document-article' }),
}))

vi.mock('@byline/admin/react', () => ({
  AdminTabs: ({ tabs }: { tabs: Array<{ name: string; label: string }> }) => (
    <div data-testid="admin-tabs">
      {tabs.map((tab) => (
        <span key={tab.name}>{tab.label}</span>
      ))}
    </div>
  ),
  renderFormatted: (value: unknown) => String(value ?? ''),
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  DiffModal: (props: Record<string, unknown>) => {
    mocks.diffModalProps.push(props)
    return <div data-testid="diff-modal" />
  },
}))

vi.mock('@byline/admin/services', () => ({
  useBylineAdminServices: () => ({
    getCollectionDocumentVersion: vi.fn(async () => ({})),
  }),
}))

vi.mock('@byline/i18n/react', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (key === 'collections.history.restoreButton') return 'Restore'
      if (key === 'collections.history.restoreButtonTitle')
        return `Restore this version as ${values?.status}`
      if (key === 'collections.restore.warning') return `New version status: ${values?.status}`
      if (key === 'collections.restore.confirmButton') return `Restore as ${values?.status}`
      if (key === 'collections.history.title') return `${values?.label} History`
      if (key === 'collections.history.audit.createdBy') return `by ${values?.label}`
      return key
    },
  }),
}))

vi.mock('@byline/ui/react', () => {
  type Props = React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }
  const Div = ({ children, ...props }: Props) => <div {...props}>{children}</div>
  const Button = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  )
  const Modal = ({ isOpen, children }: { isOpen: boolean; children?: React.ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null
  Modal.Container = Div
  Modal.Header = Div
  Modal.Content = Div
  const Table = ({ children }: { children?: React.ReactNode }) => <table>{children}</table>
  Table.Container = Div
  Table.Header = ({ children }: { children?: React.ReactNode }) => <thead>{children}</thead>
  Table.Body = ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>
  Table.Row = ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr {...props}>{children}</tr>
  )
  Table.Cell = ({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td {...props}>{children}</td>
  )
  return {
    Alert: Div,
    Button,
    CloseIcon: () => null,
    Container: Div,
    IconButton: Button,
    LoaderEllipsis: () => <span>loading</span>,
    Modal,
    Section: Div,
    Select: () => <select aria-label="page size" />,
    Table,
    useToastManager: () => ({ add: mocks.toast }),
  }
})

vi.mock('../../routes/admin-path.js', () => ({
  getAdminRouteId: () => '/admin/collections/$collection/$id/history',
  getAdminRoutePath: (...parts: string[]) => `/admin/${parts.join('/')}`,
}))

vi.mock('../../server-fns/singletons/index.js', () => ({
  findSingletonByVersion: mocks.findSingletonByVersion,
  restoreSingletonVersion: mocks.restoreSingleton,
}))

vi.mock('../../server-fns/collections/index.js', () => ({
  restoreDocumentVersion: mocks.restoreCollection,
}))

vi.mock('../chrome/loose-router.js', () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
  useNavigate: () => mocks.navigate,
}))

vi.mock('../chrome/router-pager.js', () => ({
  RouterPager: (props: { componentName: string; page: number; count: number }) => {
    mocks.pagerProps.push(props)
    return <div data-pager={props.componentName} />
  },
}))

vi.mock('../chrome/th-sortable.js', () => ({
  TableHeadingCellSortable: ({ label }: { label: string }) => <th>{label}</th>,
}))

vi.mock('../collections/document-history.js', () => ({
  DocumentHistoryView: () => <div data-testid="document-audit-log" />,
}))
vi.mock('../collections/view-menu.js', () => ({ ViewMenu: () => <div /> }))
vi.mock('./view-menu.js', () => ({ SingletonViewMenu: () => <div /> }))

import { HistoryView } from '../collections/history.js'
import { SingletonHistoryView } from './history.js'
import type { VersionHistoryData } from '../collections/version-history.js'

const singletonDefinition = {
  singleton: true,
  path: 'site-settings',
  label: 'Site settings',
  workflow: { statuses: [{ name: 'published', label: 'Published' }], defaultStatus: 'published' },
  fields: [],
} as unknown as SingletonDefinition

const collectionDefinition = {
  path: 'articles',
  labels: { singular: 'Article', plural: 'Articles' },
  useAsTitle: 'title',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
} as MultiCollectionDefinition

const data: VersionHistoryData = {
  docs: [
    {
      id: 'document-settings',
      versionId: 'version-old',
      status: 'draft',
      createdAt: '2026-08-25T10:00:00.000Z',
      createdBy: 'actor-1',
      eventType: 'update',
      fields: { title: 'Old' },
    },
    {
      id: 'document-settings',
      versionId: 'version-current',
      status: 'published',
      createdAt: '2026-08-26T10:00:00.000Z',
      createdBy: 'actor-2',
      eventType: 'update',
      fields: { title: 'Current' },
    },
  ],
  meta: { total: 2, page: 1, pageSize: 15, totalPages: 1, desc: false },
  actors: {
    'actor-1': { label: 'Ada Editor' },
    'actor-2': { label: 'Grace Editor' },
  },
}

const currentDocument = {
  revision: 7,
  id: 'document-settings',
  versionId: 'version-current',
  status: 'published',
  fields: { title: 'Current' },
}

let container: HTMLDivElement
let root: Root

function render(element: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(element))
}

function dispose() {
  act(() => root.unmount())
  container.remove()
}

afterAll(() => {
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT
})

describe('singleton version history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    mocks.location.pathname = '/admin/singletons/site-settings/history'
    mocks.location.search = {}
    mocks.pagerProps.length = 0
    mocks.diffModalProps.length = 0
  })

  it('renders an explicit singleton restore column without collection title configuration', async () => {
    render(
      <SingletonHistoryView
        singletonDefinition={singletonDefinition}
        data={data}
        currentDocument={currentDocument}
        contentLocales={[]}
        defaultContentLocale="en"
        workflowStatuses={[]}
      />
    )

    expect(container.textContent).toContain('draft')
    expect(container.textContent).toContain('published')
    expect(
      [...container.querySelectorAll('.byline-singleton-history-actor-cell')].map(
        (cell) => cell.textContent
      )
    ).toEqual(['Ada Editor', 'Grace Editor'])
    expect(container.textContent).not.toContain('collections.history.tabs.document')
    const restoreButtons = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent === 'Restore'
    )
    expect(restoreButtons).toHaveLength(1)
    expect(restoreButtons[0]?.title).toBe('Restore this version as Published')

    await act(async () => restoreButtons[0]?.click())
    expect(container.textContent).toContain('New version status: Published')
    const confirm = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Restore as Published'
    )
    await act(async () => confirm?.click())

    expect(mocks.restoreSingleton).toHaveBeenCalledWith({
      data: { singleton: 'site-settings', versionId: 'version-old', expectedRevision: 7 },
    })
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: '/admin/singletons/$singleton',
      params: { singleton: 'site-settings' },
      search: {},
    })
    dispose()
  })

  it('wires the requested page and total pages into both shared pagers', () => {
    render(
      <SingletonHistoryView
        singletonDefinition={singletonDefinition}
        data={{
          ...data,
          meta: { ...data.meta, page: 3, pageSize: 30, total: 95, totalPages: 4 },
        }}
        currentDocument={currentDocument}
        contentLocales={[]}
        defaultContentLocale="en"
        workflowStatuses={[]}
      />
    )

    expect(mocks.pagerProps).toEqual([
      expect.objectContaining({ componentName: 'pagerTop', page: 3, count: 4 }),
      expect.objectContaining({ componentName: 'pagerBottom', page: 3, count: 4 }),
    ])
    dispose()
  })

  it('opens comparison with the singleton-bound historical version loader', async () => {
    render(
      <SingletonHistoryView
        singletonDefinition={singletonDefinition}
        data={data}
        currentDocument={currentDocument}
        contentLocales={[]}
        defaultContentLocale="en"
        workflowStatuses={[]}
      />
    )

    const compare = container.querySelector<HTMLButtonElement>(
      'button[aria-label="collections.history.compareAriaLabel"]'
    )
    await act(async () => {
      compare?.click()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="diff-modal"]')).not.toBeNull()
    expect(mocks.diffModalProps).toHaveLength(1)
    expect(mocks.diffModalProps[0]).toMatchObject({
      collection: 'site-settings',
      documentId: 'document-settings',
      versionId: 'version-old',
      currentDocument,
    })

    const loadHistoricalVersion = mocks.diffModalProps[0]?.loadHistoricalVersion as (
      resourcePath: string,
      documentId: string,
      versionId: string,
      locale?: string
    ) => Promise<Record<string, unknown>>
    await loadHistoricalVersion('site-settings', 'document-settings', 'version-old', 'fr')
    expect(mocks.findSingletonByVersion).toHaveBeenCalledWith({
      data: { singleton: 'site-settings', versionId: 'version-old', locale: 'fr' },
    })
    dispose()
  })

  it('renders an empty unmaterialised history without an audit-log tab or restore action', () => {
    render(
      <SingletonHistoryView
        singletonDefinition={singletonDefinition}
        data={{
          docs: [],
          meta: { total: 0, page: 3, pageSize: 30, totalPages: 0 },
          actors: {},
        }}
        currentDocument={null}
        contentLocales={[]}
        defaultContentLocale="en"
        workflowStatuses={[]}
      />
    )

    expect(container.textContent).toContain('Site settings History')
    expect(container.textContent).not.toContain('collections.history.tabs.document')
    expect(container.querySelectorAll('button')).toHaveLength(0)
    dispose()
  })

  it('keeps the collection audit tab and title-driven restore behavior', async () => {
    mocks.location.pathname = '/admin/collections/articles/document-article/history'
    render(
      <HistoryView
        collectionDefinition={collectionDefinition}
        adminConfig={{
          slug: 'articles',
          columns: [{ fieldName: 'title', label: 'Title' }],
        }}
        data={data as never}
        auditLog={{ entries: [], meta: { total: 0, page: 1, pageSize: 100, totalPages: 0 } }}
        currentDocument={{ ...currentDocument, id: 'document-article' }}
        contentLocales={[]}
        defaultContentLocale="en"
      />
    )

    expect(container.textContent).toContain('collections.history.tabs.document')
    const restore = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Restore'
    )
    expect(restore).toBeDefined()
    expect(restore?.title).toBe('Restore this version as Draft')
    await act(async () => restore?.click())
    expect(container.textContent).toContain('New version status: Draft')
    const confirm = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Restore as Draft'
    )
    await act(async () => confirm?.click())

    expect(mocks.restoreCollection).toHaveBeenCalledWith({
      data: {
        expectedRevision: 7,
        collection: 'articles',
        id: 'document-article',
        versionId: 'version-old',
      },
    })
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: '/admin/collections/$collection/$id',
      params: { collection: 'articles', id: 'document-article' },
    })
    dispose()
  })

  it('closes and refreshes after a restore whose afterSave hook failed post-commit', async () => {
    mocks.restoreSingleton.mockResolvedValueOnce({
      status: 'committed-hook-failed',
      documentId: 'document-settings',
      documentVersionId: 'version-restored',
      sideEffectFailure: { phase: 'afterSave', code: 'ERR_UNHANDLED' },
    })
    render(
      <SingletonHistoryView
        singletonDefinition={singletonDefinition}
        data={data}
        currentDocument={currentDocument}
        contentLocales={[]}
        defaultContentLocale="en"
        workflowStatuses={[]}
      />
    )

    const restore = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Restore'
    )
    await act(async () => restore?.click())
    const confirm = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Restore as Published'
    )
    await act(async () => confirm?.click())

    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'collections.save.hookFailedToast',
      description: 'collections.save.hookFailedDescription',
      data: { intent: 'warning', iconType: 'warning', icon: true, close: true },
    })
    expect(mocks.invalidate).toHaveBeenCalledOnce()
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: '/admin/singletons/$singleton',
      params: { singleton: 'site-settings' },
      search: {},
    })
    dispose()
  })
})
