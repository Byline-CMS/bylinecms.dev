'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Detail view for a single admin role. Same drawer pattern as the
 * admin-users container: the main view shows cards for each editable
 * area, each "Edit" button opens a drawer containing the sub-form, and
 * destructive actions use a modal.
 *
 * The Permissions card opens a large-width drawer hosting the
 * per-role ability editor from `@byline/admin/admin-permissions`. The
 * editor lives in this module rather than admin-permissions because
 * the bundling action is conceptually a property of the role, even
 * though the data lives in a separate table.
 */

import type React from 'react'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import {
  Button,
  CloseIcon,
  Drawer,
  EditIcon,
  IconButton,
  Modal,
  useToastManager,
} from '@infonomic/uikit/react'
import cx from 'classnames'

import { LocalDateTime } from '@/ui/components/local-date-time'
import { DeleteRole } from './delete'
import { RolePermissions } from './permissions'
import { UpdateRole } from './update'
import type {
  ListRegisteredAbilitiesResponse,
  SetRoleAbilitiesResponse,
} from '@/modules/admin/admin-permissions'
import type { AdminRoleResponse } from '../index'

type ComponentKey = 'update' | 'delete_role' | 'permissions' | 'empty'

interface PanelProps {
  role: AdminRoleResponse
  onClose?: () => void
  onSuccess?: (role: AdminRoleResponse) => void
}

const panels: Record<
  ComponentKey,
  { title: string; drawerWidth: 'medium' | 'large'; component: React.ComponentType<PanelProps> }
> = {
  update: {
    title: 'Role Details',
    drawerWidth: 'medium',
    // Standard panel — render is delegated to the registry.
    component: UpdateRole,
  },
  delete_role: {
    title: 'Delete Admin Role',
    drawerWidth: 'medium',
    component: DeleteRole,
  },
  permissions: {
    title: 'Role Permissions',
    drawerWidth: 'large',
    // Permissions panel needs extra props (registered abilities, current
    // grants, separate success callback). The container renders it
    // inline against `current === 'permissions'` rather than through
    // this map — the entry exists so title and drawer width still
    // resolve uniformly.
    component: () => null,
  },
  empty: {
    title: '',
    drawerWidth: 'medium',
    component: () => null,
  },
}

function ContainerSection({
  title,
  onEdit,
  children,
}: {
  title: string
  onEdit?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-sm border border-gray-100 bg-canvas-25 p-4 dark:border-gray-700 dark:bg-canvas-800">
      <div className="mb-2 flex items-center justify-between">
        <h2>{title}</h2>
        {onEdit ? (
          <IconButton variant="text" onClick={onEdit} aria-label={`Edit ${title}`}>
            <EditIcon width="20px" height="20px" />
          </IconButton>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  )
}

interface RoleContainerProps {
  role: AdminRoleResponse
  registered: ListRegisteredAbilitiesResponse
  initialAbilities: string[]
}

export function RoleContainer({ role, registered, initialAbilities }: RoleContainerProps) {
  const router = useRouter()
  const toastManager = useToastManager()
  const [currentRole, setCurrentRole] = useState<AdminRoleResponse>(role)
  const [currentAbilities, setCurrentAbilities] = useState<string[]>(initialAbilities)
  const [current, setCurrent] = useState<ComponentKey>('empty')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const openDrawer = (key: ComponentKey) => () => {
    setCurrent(key)
    setIsDrawerOpen(true)
  }
  const openModal = (key: ComponentKey) => () => {
    setCurrent(key)
    setIsModalOpen(true)
  }
  const closeDrawer = () => {
    setCurrent('empty')
    setIsDrawerOpen(false)
  }
  const closeModal = () => {
    setCurrent('empty')
    setIsModalOpen(false)
  }

  const handleSuccess = (updated: AdminRoleResponse) => {
    setCurrentRole(updated)
  }

  const handlePermissionsSaved = (response: SetRoleAbilitiesResponse) => {
    setCurrentAbilities(response.abilities)
    void router.invalidate()
    toastManager.add({
      title: 'Permissions saved',
      description: `${response.abilities.length} abilities granted to ${currentRole.name}.`,
      data: { intent: 'success' },
    })
  }

  const Panel = panels[current].component

  return (
    <>
      <div className="mb-12 gap-4 sm:grid sm:grid-cols-2">
        <div className="mb-4 flex flex-col gap-4">
          <ContainerSection title="Role Details" onEdit={openDrawer('update')}>
            <p className="mb-0">
              <span className="muted">Name:</span> {currentRole.name}
            </p>
            <p className="mb-0">
              <span className="muted">Machine name:</span> {currentRole.machine_name}
            </p>
            <p className="mb-3">
              <span className="muted">Description:</span>{' '}
              {currentRole.description ?? <span className="muted italic">Not set</span>}
            </p>
            <Button size="sm" onClick={openDrawer('update')}>
              Update Details
            </Button>
            <div className="muted mt-4 text-xs">
              <p>
                <span className="font-bold">Created:&nbsp;</span>
                <LocalDateTime value={currentRole.created_at} />
              </p>
              <p className="mb-0">
                <span className="font-bold">Updated:&nbsp;</span>
                <LocalDateTime value={currentRole.updated_at} />
              </p>
            </div>
          </ContainerSection>
        </div>

        <div className="flex flex-col gap-4">
          <ContainerSection title="Permissions" onEdit={openDrawer('permissions')}>
            <p className="mb-3">
              <span className="muted">{currentAbilities.length}</span> of{' '}
              <span className="muted">{registered.total}</span> abilities granted to this role.
            </p>
            <Button size="sm" onClick={openDrawer('permissions')}>
              Edit Permissions
            </Button>
          </ContainerSection>

          <ContainerSection title="Delete Role">
            <p className="mb-3">
              Permanently delete this role. Any user assignments and ability grants are removed.
            </p>
            <Button size="sm" intent="danger" onClick={openModal('delete_role')}>
              Delete Role
            </Button>
          </ContainerSection>
        </div>
      </div>

      <Drawer
        id="admin-role-drawer"
        closeOnOverlayClick={false}
        width="medium"
        topOffset="46px"
        isOpen={isDrawerOpen}
        onDismiss={closeDrawer}
        className={cx(
          panels[current].drawerWidth === 'large' ? 'md:w-[700px] lg:w-[800px]' : 'md:w-[500px]'
        )}
      >
        <Drawer.Container aria-hidden={!isDrawerOpen} className="p-2">
          <Drawer.TopActions>
            <button type="button" tabIndex={0} className="sr-only">
              no action
            </button>
            <IconButton aria-label="Close" size="sm" onClick={closeDrawer}>
              <CloseIcon width="14px" height="14px" svgClassName="white-icon stroke-white" />
            </IconButton>
          </Drawer.TopActions>
          <Drawer.Header>
            <h2>{panels[current].title}</h2>
          </Drawer.Header>
          <Drawer.Content>
            <div className="max-h-[calc(100vh-160px)] overflow-y-auto">
              {current === 'permissions' ? (
                <RolePermissions
                  role={currentRole}
                  registered={registered}
                  initialAbilities={currentAbilities}
                  onClose={closeDrawer}
                  onSaved={handlePermissionsSaved}
                />
              ) : (
                <Panel role={currentRole} onClose={closeDrawer} onSuccess={handleSuccess} />
              )}
            </div>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>

      <Modal isOpen={isModalOpen} onDismiss={closeModal} closeOnOverlayClick={false}>
        <Modal.Container className="sm:mb-24 sm:max-w-[550px]">
          <Modal.Header className="mb-4 flex items-center justify-between">
            <h3 className="m-0">{panels[current].title}</h3>
            <IconButton aria-label="Close" size="sm" onClick={closeModal}>
              <CloseIcon width="14px" height="14px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Panel role={currentRole} onClose={closeModal} onSuccess={handleSuccess} />
        </Modal.Container>
      </Modal>
    </>
  )
}
