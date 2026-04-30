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

import type {
  AdminRoleListResponse,
  AdminRoleResponse,
} from '@byline/host-tanstack-start/server-fns/admin-roles'
import { reorderAdminRoles } from '@byline/host-tanstack-start/server-fns/admin-roles/reorder'
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

import { LangLink } from '@/i18n/components/lang-link'
import { formatNumber } from '@/utils/utils.general'

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
      <Table.Cell className="w-[2%]">
        <div className="cursor-grab" {...attributes} {...listeners}>
          <GripperVerticalIcon />
        </div>
      </Table.Cell>
      <Table.Cell>
        <LangLink to={`/admin/roles/${item.id}`}>{item.name}</LangLink>
      </Table.Cell>
      <Table.Cell>{item.machine_name}</Table.Cell>
      <Table.Cell>{item.description ?? <span className="muted italic">Not set</span>}</Table.Cell>
      <Table.Cell className="text-right">
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
      className="h-[32px] border-none"
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
        <div className="flex items-center gap-3 py-[2px]">
          <h1 className="!m-0 pb-[2px]">Admin Roles</h1>
          <Stats total={data.roles.length} />
          <IconButton aria-label="Create New Admin Role" onClick={openCreateDrawer}>
            <PlusIcon height="18px" width="18px" svgClassName="stroke-white" />
          </IconButton>
        </div>

        {items.length === 0 ? (
          <div className="caption-bottom text-center mt-[6vh]">No admin roles found</div>
        ) : (
          <DraggableSortable ids={items.map((item) => item.id)} onDragEnd={handleOnDragEnd}>
            <Table.Container className="mt-2 mb-3">
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeadingCell className="w-[2%] p-2" />
                    <Table.HeadingCell className="w-[20%]">Name</Table.HeadingCell>
                    <Table.HeadingCell className="w-[20%]">Machine Name</Table.HeadingCell>
                    <Table.HeadingCell className="w-[40%]">Description</Table.HeadingCell>
                    <Table.HeadingCell className="w-[18%] text-right">Created</Table.HeadingCell>
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
          <div className="pr-1 py-1">
            <form onSubmit={handleOnSave} noValidate className="flex w-full flex-col">
              <div className="form-actions flex justify-end gap-2">
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
            <h2>New Admin Role</h2>
          </Drawer.Header>
          <Drawer.Content>
            <div className="max-h-[calc(100vh-160px)] overflow-y-auto">
              <CreateAdminRole onClose={closeCreateDrawer} onSuccess={handleCreateSuccess} />
            </div>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>
    </Section>
  )
}
