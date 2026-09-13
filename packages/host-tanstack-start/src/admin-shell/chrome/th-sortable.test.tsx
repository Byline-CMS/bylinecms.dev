import { act, type ComponentProps } from 'react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from '@tanstack/react-router'

import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { collectionListSearchSchema } from '../../routes/list-return-state.js'
import { resolveListViewState } from '../../server-fns/collections/list-view-state.js'
import { TableHeadingCellSortable } from './th-sortable.js'

vi.mock('@byline/ui/react', () => ({
  Table: {
    HeadingCell: (props: ComponentProps<'th'>) => <th {...props} />,
  },
}))

// Some host applications preserve wire values as strings and repeated keys as
// arrays for their public catalogue URLs. Admin routes share that router and
// must parse booleans rather than assume the default parser.
function parseWireSearch(search: string): Record<string, unknown> {
  const params = new URLSearchParams(search)
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key)
      return [key, values.length === 1 ? values[0] : values]
    })
  )
}

function stringifyWireSearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value == null) continue
    for (const entry of Array.isArray(value) ? value : [value]) {
      params.append(key, String(entry))
    }
  }
  return params.size ? `?${params}` : ''
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe.each(['default', 'wire'] as const)('%s search parser', (parser) => {
  it.each([true, false])(
    'toggles sort requests and indicators with effective metadata: %s',
    async (effective) => {
      const rootRoute = createRootRoute()
      const route = createRoute({
        getParentRoute: () => rootRoute,
        path: '/admin/collections/news',
        validateSearch: collectionListSearchSchema,
        loaderDeps: ({ search }) => search,
        loader: ({ deps }) =>
          resolveListViewState({
            params: deps,
            preference: null,
            orderable: false,
            sortableFields: ['title'],
          }),
        component: () => {
          const data = route.useLoaderData()
          // Match ListView: location.search is the host parser's raw output,
          // unlike route.useSearch(), which has already passed validation.
          const location = useRouterState({ select: (s) => s.location })
          const search = location.search as { order?: string; desc?: boolean }
          return (
            <table>
              <thead>
                <tr>
                  <TableHeadingCellSortable
                    fieldName="title"
                    label="Title"
                    sortable
                    {...(effective
                      ? {
                          activeOrder: search.order ?? data.metaOrder,
                          activeDesc: search.order != null ? search.desc : data.metaDesc,
                        }
                      : {})}
                  />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{JSON.stringify(data.sort)}</td>
                </tr>
              </tbody>
            </table>
          )
        },
      })
      const router = createRouter({
        routeTree: rootRoute.addChildren([route]),
        history: createMemoryHistory({
          initialEntries: ['/admin/collections/news?order=title&desc=true'],
        }),
        ...(parser === 'wire'
          ? { parseSearch: parseWireSearch, stringifySearch: stringifyWireSearch }
          : {}),
      })
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      try {
        await act(async () => {
          await router.load()
          root.render(<RouterProvider router={router} />)
        })
        expect(container.querySelector('button')?.textContent).toBe('TitleZA')
        for (const direction of ['asc', 'desc', 'asc']) {
          await act(async () => {
            container.querySelector('button')?.click()
            await vi.waitFor(() => expect(router.state.status).toBe('idle'))
          })
          expect(container.querySelector('td')?.textContent).toBe(
            JSON.stringify({ title: direction })
          )
          expect(container.querySelector('button')?.textContent).toBe(
            direction === 'asc' ? 'TitleAZ' : 'TitleZA'
          )
        }
      } finally {
        await act(async () => root.unmount())
        container.remove()
      }
    }
  )
})
