'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'

import { CreateAdminUser, LocalDateTime } from '@byline/ui'
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

import { Link, useNavigate } from '../chrome/loose-router.js'
import { RouterPager } from '../chrome/router-pager.js'
import {
  TableHeadingCellSortable,
  type TableHeadingCellSortableProps,
} from '../chrome/th-sortable.js'
import { formatNumber } from '../chrome/utils.js'
import styles from './list.module.css'
import type {
  AdminUserListResponse,
  AdminUserResponse,
} from '../../server-fns/admin-users/index.js'

const tableColumnDefs: Omit<TableHeadingCellSortableProps, 'lng'>[] = [
  {
    fieldName: 'given_name',
    label: 'Given Name',
    path: '/admin/users',
    sortable: true,
    scope: 'col',
    align: 'left',
    className: 'byline-admin-users-list-col-given',
  },
  {
    fieldName: 'family_name',
    label: 'Family Name',
    path: '/admin/users',
    sortable: true,
    scope: 'col',
    align: 'left',
    className: 'byline-admin-users-list-col-family',
  },
  {
    fieldName: 'email',
    label: 'Email',
    path: '/admin/users',
    sortable: true,
    scope: 'col',
    align: 'left',
    className: 'byline-admin-users-list-col-email',
  },
  {
    fieldName: 'updated_at',
    label: 'Updated',
    path: '/admin/users',
    sortable: true,
    scope: 'col',
    align: 'right',
    className: 'byline-admin-users-list-col-date',
  },
  {
    fieldName: 'created_at',
    label: 'Created',
    path: '/admin/users',
    sortable: true,
    scope: 'col',
    align: 'right',
    className: 'byline-admin-users-list-col-date',
  },
]

function Stats({ total }: { total: number }) {
  return (
    <span className={cx('byline-admin-users-list-stats', styles.stats)}>
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
      className={cx('byline-admin-users-list-pad-row', styles.padRow)}
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
      to: pathname as never,
      search: (current: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...current }
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
        <div className={cx('byline-admin-users-list-head', styles.head)}>
          <h1 className={cx('byline-admin-users-list-title', styles.title)}>Admin Users</h1>
          <Stats total={data.meta.total} />
          <IconButton aria-label="Create New Admin User" onClick={openCreateDrawer}>
            <PlusIcon height="18px" width="18px" svgClassName="stroke-white" />
          </IconButton>
        </div>
        <div className={cx('byline-admin-users-list-options', styles.options)}>
          <Search
            onSearch={handleOnSearch}
            onClear={handleOnClear}
            inputSize="sm"
            placeholder="Search by name or email"
            className={cx('byline-admin-users-list-search', styles.search)}
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
        <Table.Container className={cx('byline-admin-users-list-table-wrap', styles.tableWrap)}>
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
                <Table.Row
                  key={user.id}
                  className={cx({
                    'byline-admin-users-list-disabled': !user.is_enabled,
                    [styles.disabled]: !user.is_enabled,
                  })}
                >
                  <Table.Cell>
                    <Link to={'/admin/users/$id' as never} params={{ id: user.id }}>
                      {user.given_name ?? (
                        <span
                          className={cx('muted byline-admin-users-list-not-set', styles.notSet)}
                        >
                          Not set
                        </span>
                      )}
                    </Link>
                  </Table.Cell>
                  <Table.Cell>
                    {user.family_name ?? (
                      <span className={cx('muted byline-admin-users-list-not-set', styles.notSet)}>
                        Not set
                      </span>
                    )}
                  </Table.Cell>
                  <Table.Cell>{user.email}</Table.Cell>
                  <Table.Cell
                    className={cx('byline-admin-users-list-cell-right', styles.cellRight)}
                  >
                    <LocalDateTime value={user.updated_at} />
                  </Table.Cell>
                  <Table.Cell
                    className={cx('byline-admin-users-list-cell-right', styles.cellRight)}
                  >
                    <LocalDateTime value={user.created_at} />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          {padRows(Math.max(0, 6 - data.users.length))}
        </Table.Container>
        <div
          className={cx(
            'byline-admin-users-list-options byline-admin-users-list-options-bottom',
            styles.options,
            styles.optionsBottom
          )}
        >
          <Select
            containerClassName={cx('byline-admin-users-list-page-size', styles.pageSize)}
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
        className={cx('byline-admin-users-list-drawer', styles.drawer)}
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
            <div className={cx('byline-admin-users-list-drawer-scroll', styles.drawerScroll)}>
              <CreateAdminUser onClose={closeCreateDrawer} onSuccess={handleCreateSuccess} />
            </div>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>
    </Section>
  )
}
