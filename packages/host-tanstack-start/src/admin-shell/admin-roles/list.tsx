'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin-roles list view.
 *
 * Two distinguishing features vs. admin-users:
 *  - **No search/sort/pagination.** The role set is small by design;
 *    presentation order is editorial via drag-and-drop.
 *  - **Drag-to-reorder.** Re-ordered ids are sent to `reorderAdminRoles`
 *    on Save; the Save button only appears once an order change exists.
 *
 * Optimistic UI: the local `items` state is updated immediately on drag
 * end. If the server rejects the reorder we revert and surface a toast.
 */

import type React from 'react'
import { type FormEvent, useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import {
  CreateAdminRole,
  DraggableSortable,
  LocalDateTime,
  moveItem,
  useSortable,
} from '@byline/ui'
import {
  Button,
  CloseIcon,
  Container,
  Drawer,
  GripperVerticalIcon,
  IconButton,
  LoaderEllipsis,
  PlusIcon,
  Section,
  Table,
  useToastManager,
} from '@infonomic/uikit/react'
import cx from 'classnames'

import { reorderAdminRoles } from '../../server-fns/admin-roles/reorder.js'
import { Link } from '../chrome/loose-router.js'
import { formatNumber } from '../chrome/utils.js'
import styles from './list.module.css'
import type {
  AdminRoleListResponse,
  AdminRoleResponse,
} from '../../server-fns/admin-roles/index.js'

function Stats({ total }: { total: number }) {
  return (
    <span className={cx('byline-roles-list-stats', styles.stats)}>{formatNumber(total, 0)}</span>
  )
}

interface DraggableRowProps {
  item: AdminRoleResponse
  disabled: boolean
}

const DraggableRow: React.FC<DraggableRowProps> = ({ item, disabled }) => {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: item.id,
    disabled,
    transition: {
      duration: 250,
      easing: 'cubic-bezier(0, 0.2, 0.2, 1)',
    },
  })

  return (
    <Table.Row
      // useSortable returns a SetterFn; Table.Row expects an intersected
      // Ref & RefObject. The cast is the same workaround used in the
      // infonomic.io list-view; @dnd-kit's Ref shape doesn't satisfy
      // React 19's intersected ref type.
      // biome-ignore lint/suspicious/noExplicitAny: dnd-kit ref shape
      ref={setNodeRef as any}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        zIndex: isDragging ? 10 : 'auto',
      }}
    >
      <Table.Cell className={cx('byline-roles-list-grip-cell', styles.gripCell)}>
        <div className={cx('byline-roles-list-grip', styles.grip)} {...attributes} {...listeners}>
          <GripperVerticalIcon />
        </div>
      </Table.Cell>
      <Table.Cell>
        <Link to={'/admin/roles/$id' as never} params={{ id: item.id }}>
          {item.name}
        </Link>
      </Table.Cell>
      <Table.Cell>{item.machine_name}</Table.Cell>
      <Table.Cell>
        {item.description ?? (
          <span className={cx('muted byline-roles-list-not-set', styles.notSet)}>Not set</span>
        )}
      </Table.Cell>
      <Table.Cell className={cx('byline-roles-list-cell-right', styles.cellRight)}>
        <LocalDateTime value={item.created_at} />
      </Table.Cell>
    </Table.Row>
  )
}

function padRows(value: number) {
  return Array.from({ length: value }).map((_, index) => (
    <div
      key={`empty-row-${
        // biome-ignore lint/suspicious/noArrayIndexKey: static filler
        index
      }`}
      className={cx('byline-roles-list-pad-row', styles.padRow)}
    >
      &nbsp;
    </div>
  ))
}

export function AdminRolesListView({ data }: { data: AdminRoleListResponse }) {
  const router = useRouter()
  const toastManager = useToastManager()
  const [items, setItems] = useState<AdminRoleResponse[]>(data.roles)
  const [orderChanged, setOrderChanged] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false)

  // Sync local `items` to fresh loader data after a `router.invalidate()`.
  // We hold local state for the optimistic drag-and-drop UI, so without
  // this effect a newly-created or deleted role wouldn't appear until
  // the page was reloaded. Skip the sync while the user has an unsaved
  // reorder in flight — clobbering their pending edit would be worse
  // than the slightly-stale list.
  useEffect(() => {
    if (!orderChanged) {
      setItems(data.roles)
    }
  }, [data.roles, orderChanged])

  const openCreateDrawer = () => setIsCreateDrawerOpen(true)
  const closeCreateDrawer = () => setIsCreateDrawerOpen(false)

  const handleCreateSuccess = (created: AdminRoleResponse) => {
    setIsCreateDrawerOpen(false)
    void router.invalidate()
    toastManager.add({
      title: 'Admin role created',
      description: created.name,
      data: { intent: 'success' },
    })
  }

  const handleOnDragEnd = ({
    moveFromIndex,
    moveToIndex,
  }: {
    event: unknown
    moveFromIndex: number
    moveToIndex: number
  }) => {
    if (moveFromIndex < 0 || moveToIndex < 0 || moveFromIndex === moveToIndex) return
    setItems((current) => moveItem(current, moveFromIndex, moveToIndex))
    setOrderChanged(true)
  }

  async function handleOnSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (isSaving) return
    setIsSaving(true)
    const previousItems = items
    try {
      await reorderAdminRoles({ data: { ids: items.map((role) => role.id) } })
      setOrderChanged(false)
      void router.invalidate()
      toastManager.add({
        title: 'Order saved',
        data: { intent: 'success' },
      })
    } catch (_err) {
      // Revert local state so the table reflects what's actually stored.
      setItems(previousItems)
      setOrderChanged(false)
      toastManager.add({
        title: 'Could not save the new order',
        description: 'Please try again.',
        data: { intent: 'danger' },
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Section>
      <Container>
        <div className={cx('byline-roles-list-head', styles.head)}>
          <h1 className={cx('byline-roles-list-title', styles.title)}>Admin Roles</h1>
          <Stats total={data.roles.length} />
          <IconButton aria-label="Create New Admin Role" onClick={openCreateDrawer}>
            <PlusIcon height="18px" width="18px" svgClassName="stroke-white" />
          </IconButton>
        </div>

        {items.length === 0 ? (
          <div className={cx('byline-roles-list-empty', styles.empty)}>No admin roles found</div>
        ) : (
          <DraggableSortable ids={items.map((item) => item.id)} onDragEnd={handleOnDragEnd}>
            <Table.Container className={cx('byline-roles-list-table-wrap', styles.tableWrap)}>
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeadingCell
                      className={cx('byline-roles-list-col-drag', styles.colDrag)}
                    />
                    <Table.HeadingCell className={cx('byline-roles-list-col-name', styles.colName)}>
                      Name
                    </Table.HeadingCell>
                    <Table.HeadingCell
                      className={cx('byline-roles-list-col-machine', styles.colMachine)}
                    >
                      Machine Name
                    </Table.HeadingCell>
                    <Table.HeadingCell
                      className={cx('byline-roles-list-col-description', styles.colDescription)}
                    >
                      Description
                    </Table.HeadingCell>
                    <Table.HeadingCell
                      className={cx('byline-roles-list-col-created', styles.colCreated)}
                    >
                      Created
                    </Table.HeadingCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {items.map((role) => (
                    <DraggableRow key={role.id} item={role} disabled={isSaving} />
                  ))}
                </Table.Body>
              </Table>
              {padRows(Math.max(0, 6 - items.length))}
            </Table.Container>
          </DraggableSortable>
        )}

        {orderChanged ? (
          <div className={cx('byline-roles-list-save', styles.save)}>
            <form
              onSubmit={handleOnSave}
              noValidate
              className={cx('byline-roles-list-save-form', styles.saveForm)}
            >
              <div className={cx('byline-roles-list-save-actions', styles.saveActions)}>
                <Button type="submit" size="sm" disabled={isSaving}>
                  {isSaving ? (
                    <LoaderEllipsis size={30} color="#aaaaaa" />
                  ) : (
                    <span>Save Order</span>
                  )}
                </Button>
              </div>
            </form>
          </div>
        ) : null}
      </Container>

      <Drawer
        id="admin-roles-create-drawer"
        closeOnOverlayClick={false}
        width="medium"
        topOffset="50px"
        isOpen={isCreateDrawerOpen}
        onDismiss={closeCreateDrawer}
        className={cx('byline-roles-list-drawer', styles.drawer)}
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
            <h2>New Admin Role</h2>
          </Drawer.Header>
          <Drawer.Content>
            <div className={cx('byline-roles-list-drawer-scroll', styles.drawerScroll)}>
              <CreateAdminRole onClose={closeCreateDrawer} onSuccess={handleCreateSuccess} />
            </div>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>
    </Section>
  )
}
