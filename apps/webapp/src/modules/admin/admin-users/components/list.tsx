'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'

import {
  CloseIcon,
  Container,
  Drawer,
  IconButton,
  PlusIcon,
  Search,
  Section,
  Select,
  Table,
  useToastManager,
} from '@infonomic/uikit/react'
import cx from 'classnames'

import { LangLink } from '@/i18n/components/lang-link'
import { LocalDateTime } from '@/ui/components/local-date-time'
import { RouterPager } from '@/ui/components/router-pager'
import {
  TableHeadingCellSortable,
  type TableHeadingCellSortableProps,
} from '@/ui/components/th-sortable'
import { formatNumber } from '@/utils/utils.general'
import { CreateAdminUser } from './create'
import type { AdminUserListResponse, AdminUserResponse } from '../index'

const tableColumnDefs: Omit<TableHeadingCellSortableProps, 'lng'>[] = [
  {
    fieldName: 'given_name',
    label: 'Given Name',
    path: '/admin/users',
    sortable: true,
    scope: 'col',
    align: 'left',
    className: 'w-[18%]',
  },
  {
    fieldName: 'family_name',
    label: 'Family Name',
    path: '/admin/users',
    sortable: true,
    scope: 'col',
    align: 'left',
    className: 'w-[18%]',
  },
  {
    fieldName: 'email',
    label: 'Email',
    path: '/admin/users',
    sortable: true,
    scope: 'col',
    align: 'left',
    className: 'w-[28%]',
  },
  {
    fieldName: 'updated_at',
    label: 'Updated',
    path: '/admin/users',
    sortable: true,
    scope: 'col',
    align: 'right',
    className: 'w-[18%]',
  },
  {
    fieldName: 'created_at',
    label: 'Created',
    path: '/admin/users',
    sortable: true,
    scope: 'col',
    align: 'right',
    className: 'w-[18%]',
  },
]

function Stats({ total }: { total: number }) {
  return (
    <span
      className={cx(
        'flex items-center justify-center mr-auto h-[28px] min-w-[28px] px-[6px] py-[5px] -mb-[4px]',
        'whitespace-nowrap text-sm leading-0',
        'bg-gray-25 dark:bg-canvas-700 border rounded-md'
      )}
    >
      {formatNumber(total, 0)}
    </span>
  )
}

function padRows(value: number) {
  return Array.from({ length: value }).map((_, index) => (
    <div
      key={`empty-row-${
        // biome-ignore lint/suspicious/noArrayIndexKey: static filler
        index
        }`}
      className="h-[32px] border-none"
    >
      &nbsp;
    </div>
  ))
}

/**
 * Admin-users list view.
 *
 * The server-fn layer returns `AdminUserListResponse` — rows already
 * shaped via `toAdminUser`, meta for pagination. Sorting / searching /
 * paging is expressed through URL search params; the route loader picks
 * those up and re-queries.
 */
export function AdminUsersListView({ data }: { data: AdminUserListResponse }) {
  const navigate = useNavigate()
  const router = useRouter()
  const toastManager = useToastManager()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false)

  const openCreateDrawer = () => setIsCreateDrawerOpen(true)
  const closeCreateDrawer = () => setIsCreateDrawerOpen(false)

  const handleCreateSuccess = (created: AdminUserResponse) => {
    setIsCreateDrawerOpen(false)
    // Re-run the list loader so the newly created user appears in the
    // current page of the table.
    void router.invalidate()
    toastManager.add({
      title: 'Admin user created',
      description: created.email,
      data: { intent: 'success' },
    })
  }

  function updateSearch(patch: Record<string, string | number | boolean | undefined>) {
    navigate({
      to: pathname,
      search: (current) => {
        const next: Record<string, unknown> = { ...(current as Record<string, unknown>) }
        for (const [key, value] of Object.entries(patch)) {
          if (value == null || value === '') {
            delete next[key]
          } else {
            next[key] = value
          }
        }
        return next
      },
    })
  }

  const handleOnSearch = (query: string) => {
    updateSearch({ page: undefined, query: query.length > 0 ? query : undefined })
  }
  const handleOnClear = () => {
    updateSearch({ page: undefined, query: undefined })
  }
  const handleOnPageSizeChange = (value: unknown) => {
    const pageSize = String(value)
    if (pageSize.length === 0) return
    updateSearch({ page: undefined, page_size: Number(pageSize) })
  }

  return (
    <Section>
      <Container>
        <div className="flex items-center gap-3 py-[2px]">
          <h1 className="!m-0 pb-[2px]">Admin Users</h1>
          <Stats total={data.meta.total} />
          <IconButton aria-label="Create New Admin User" onClick={openCreateDrawer}>
            <PlusIcon height="18px" width="18px" svgClassName="stroke-white" />
          </IconButton>
        </div>
        <div className="options flex flex-col gap-2 sm:flex-row items-start sm:items-center mt-3 mb-3">
          <Search
            onSearch={handleOnSearch}
            onClear={handleOnClear}
            inputSize="sm"
            placeholder="Search by name or email"
            className="mr-auto w-full max-w-[350px]"
          />
          <RouterPager
            page={data.meta.page}
            count={data.meta.total_pages}
            showFirstButton
            showLastButton
            componentName="pagerTop"
            aria-label="Top Pager"
          />
        </div>
        <Table.Container className="mt-2 mb-3">
          <Table>
            <Table.Header>
              <Table.Row>
                {tableColumnDefs.map((column) => (
                  <TableHeadingCellSortable key={column.fieldName} {...column} ref={undefined} />
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.users.map((user) => (
                <Table.Row key={user.id} className={cx({ 'text-red-500': !user.is_enabled })}>
                  <Table.Cell>
                    <LangLink to={`/admin/users/${user.id}`}>
                      {user.given_name ?? <span className="muted italic">Not set</span>}
                    </LangLink>
                  </Table.Cell>
                  <Table.Cell>
                    {user.family_name ?? <span className="muted italic">Not set</span>}
                  </Table.Cell>
                  <Table.Cell>{user.email}</Table.Cell>
                  <Table.Cell className="text-right">
                    <LocalDateTime value={user.updated_at} />
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <LocalDateTime value={user.created_at} />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          {padRows(Math.max(0, 6 - data.users.length))}
        </Table.Container>
        <div className="options flex flex-col gap-2 sm:flex-row items-start sm:items-center mb-5">
          <Select
            containerClassName="sm:ml-auto"
            id="page_size"
            name="page_size"
            size="sm"
            defaultValue={String(data.meta.page_size)}
            onValueChange={handleOnPageSizeChange}
            items={[
              { value: '10', label: '10' },
              { value: '20', label: '20' },
              { value: '50', label: '50' },
              { value: '100', label: '100' },
            ]}
          />
          <RouterPager
            smoothScrollToTop={true}
            page={data.meta.page}
            count={data.meta.total_pages}
            showFirstButton
            showLastButton
            componentName="pagerBottom"
            aria-label="Bottom Pager"
          />
        </div>
      </Container>

      <Drawer
        id="admin-users-create-drawer"
        closeOnOverlayClick={false}
        width="medium"
        topOffset="50px"
        isOpen={isCreateDrawerOpen}
        onDismiss={closeCreateDrawer}
        className="md:w-[600px]"
      >
        <Drawer.Container aria-hidden={!isCreateDrawerOpen} className="p-2">
          <Drawer.TopActions>
            <button type="button" tabIndex={0} className="sr-only">
              no action
            </button>
            <IconButton aria-label="Close" size="sm" onClick={closeCreateDrawer}>
              <CloseIcon width="14px" height="14px" svgClassName="white-icon stroke-white" />
            </IconButton>
          </Drawer.TopActions>
          <Drawer.Header>
            <h2>New Admin User</h2>
          </Drawer.Header>
          <Drawer.Content>
            <div className="max-h-[calc(100vh-160px)] overflow-y-auto">
              <CreateAdminUser onClose={closeCreateDrawer} onSuccess={handleCreateSuccess} />
            </div>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>
    </Section>
  )
}
