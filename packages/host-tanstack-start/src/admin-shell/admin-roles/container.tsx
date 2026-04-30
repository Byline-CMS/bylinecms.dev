'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Detail view for a single admin role.
 *
 * Layout:
 *   - **Header panel** (single, full-width): role identity (name,
 *     machine_name, description, timestamps) plus `Edit Details` and
 *     `Delete Role` buttons. The drawer continues to host the edit
 *     form; the modal hosts the delete confirmation.
 *   - **Permissions list** (full-width, inline): the per-role ability
 *     editor in `RolePermissions`. Defaults to view mode; click Edit
 *     in its controls row to switch to interactive checkboxes.
 *
 * The drawer is now used only for editing role details; the permissions
 * editor is inline. This trades a single drawer surface for a full-page
 * inspector-style view.
 */

import type React from 'react'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { LocalDateTime, RolePermissions, UpdateRole } from '@byline/ui'
import {
  Button,
  CloseIcon,
  Drawer,
  IconButton,
  Modal,
  useToastManager,
} from '@infonomic/uikit/react'
import cx from 'classnames'

import styles from './container.module.css'
import { DeleteRole } from './delete.js'
import type {
  ListRegisteredAbilitiesResponse,
  SetRoleAbilitiesResponse,
} from '../../server-fns/admin-permissions/index.js'
import type { AdminRoleResponse } from '../../server-fns/admin-roles/index.js'

type ComponentKey = 'update' | 'delete_role' | 'empty'

interface PanelProps {
  role: AdminRoleResponse
  onClose?: () => void
  onSuccess?: (role: AdminRoleResponse) => void
}

const panels: Record<ComponentKey, { title: string; component: React.ComponentType<PanelProps> }> =
  {
    update: { title: 'Role Details', component: UpdateRole },
    delete_role: { title: 'Delete Admin Role', component: DeleteRole },
    empty: { title: '', component: () => null },
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
      <div className={cx('byline-role-detail-card', styles.card)}>
        <div className={cx('byline-role-detail-head', styles.head)}>
          <h2 className={cx('byline-role-detail-title', styles.title)}>Role Details</h2>
          <div className={cx('byline-role-detail-actions', styles.actions)}>
            <Button size="xs" intent="secondary" onClick={openDrawer('update')}>
              Edit Details
            </Button>
            <Button size="xs" intent="danger" onClick={openModal('delete_role')}>
              Delete Role
            </Button>
          </div>
        </div>
        <div className={cx('byline-role-detail-grid', styles.grid)}>
          <p className={cx('byline-role-detail-row', styles.row)}>
            <span className="muted">Name:</span> {currentRole.name}
          </p>
          <p className={cx('byline-role-detail-row', styles.row)}>
            <span className="muted">Machine name:</span> {currentRole.machine_name}
          </p>
          <p
            className={cx(
              'byline-role-detail-row byline-role-detail-grid-full',
              styles.row,
              styles.gridFull
            )}
          >
            <span className="muted">Description:</span>{' '}
            {currentRole.description ?? (
              <span className={cx('muted byline-role-detail-not-set', styles.notSet)}>Not set</span>
            )}
          </p>
        </div>
        <div className={cx('muted byline-role-detail-meta', styles.meta)}>
          <p className={cx('byline-role-detail-row', styles.row)}>
            <span className="font-bold">Created:&nbsp;</span>
            <LocalDateTime value={currentRole.created_at} />
          </p>
          <p className={cx('byline-role-detail-row', styles.row)}>
            <span className="font-bold">Updated:&nbsp;</span>
            <LocalDateTime value={currentRole.updated_at} />
          </p>
        </div>
      </div>

      <RolePermissions
        role={currentRole}
        registered={registered}
        initialAbilities={currentAbilities}
        onSaved={handlePermissionsSaved}
      />

      <Drawer
        id="admin-role-drawer"
        closeOnOverlayClick={false}
        width="medium"
        topOffset="46px"
        isOpen={isDrawerOpen}
        onDismiss={closeDrawer}
        className={cx('byline-role-detail-drawer', styles.drawer)}
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
            <div className={cx('byline-role-detail-drawer-content', styles.drawerContent)}>
              <Panel role={currentRole} onClose={closeDrawer} onSuccess={handleSuccess} />
            </div>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>

      <Modal isOpen={isModalOpen} onDismiss={closeModal} closeOnOverlayClick={false}>
        <Modal.Container className={cx('byline-role-detail-modal', styles.modal)}>
          <Modal.Header className={cx('byline-role-detail-modal-head', styles.modalHead)}>
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
