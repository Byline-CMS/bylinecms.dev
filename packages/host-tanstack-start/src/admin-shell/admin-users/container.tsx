'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { LocalDateTime, SetPassword, UpdateUser, UserRoles } from '@byline/ui'
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

import styles from './container.module.css'
import { DeleteUser } from './delete.js'
import type { AdminRoleResponse } from '../../server-fns/admin-roles/index.js'
import type { AdminUserResponse, UserRolesResponse } from '../../server-fns/admin-users/index.js'

/**
 * Detail view for a single admin user, built around Infonomic's drawer
 * pattern: the main view shows cards for each editable area of the
 * record, and each "Edit" button opens a drawer containing the
 * sub-form. Destructive actions (delete) use a modal instead of a
 * drawer.
 *
 * Each sub-panel is a self-contained form component receiving
 * `(user, onClose, onSuccess)`. Forms that return a fresh user (the
 * update and set-password flows) lift it into `currentUser` via
 * `handleSuccess` so subsequent edits see the bumped `vid`. Delete
 * navigates away internally; its `onSuccess` is unused.
 *
 * The roles drawer is special-cased: it needs `allRoles` (the catalog
 * to render the checkbox list) and `initialRoleIds` (pre-checked from
 * the user's current assignments). It's rendered inline against
 * `current === 'roles'` rather than going through the panels map —
 * same trick the role-detail container uses for its permissions
 * panel.
 */

type ComponentKey = 'update' | 'set_password' | 'delete_user' | 'roles' | 'empty'

interface PanelProps {
  user: AdminUserResponse
  onClose?: () => void
  onSuccess?: (user: AdminUserResponse) => void
}

const panels: Record<
  ComponentKey,
  { title: string; drawerWidth: 'medium' | 'large'; component: React.ComponentType<PanelProps> }
> = {
  update: {
    title: 'Account Details',
    drawerWidth: 'medium',
    component: UpdateUser,
  },
  set_password: {
    title: 'Set Password',
    drawerWidth: 'medium',
    component: SetPassword,
  },
  delete_user: {
    title: 'Delete Admin User',
    drawerWidth: 'medium',
    component: DeleteUser,
  },
  roles: {
    title: 'User Roles',
    drawerWidth: 'medium',
    // See container header docstring — rendered inline, this is a stub.
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
    <div className={cx('byline-admin-user-section', styles.section)}>
      <div className={cx('byline-admin-user-section-head', styles.sectionHead)}>
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

function RoleBadge({ role }: { role: AdminRoleResponse }) {
  return (
    <span
      title={role.machine_name}
      className={cx('byline-admin-user-role-badge', styles.roleBadge)}
    >
      {role.name}
    </span>
  )
}

interface AccountContainerProps {
  user: AdminUserResponse
  allRoles: AdminRoleResponse[]
  initialUserRoles: AdminRoleResponse[]
}

export function AccountContainer({ user, allRoles, initialUserRoles }: AccountContainerProps) {
  const router = useRouter()
  const toastManager = useToastManager()
  const [currentUser, setCurrentUser] = useState<AdminUserResponse>(user)
  const [currentUserRoles, setCurrentUserRoles] = useState<AdminRoleResponse[]>(initialUserRoles)
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

  const handleSuccess = (updated: AdminUserResponse) => {
    setCurrentUser(updated)
  }

  const handleRolesSaved = (response: UserRolesResponse) => {
    setCurrentUserRoles(response.roles)
    void router.invalidate()
    toastManager.add({
      title: 'Roles saved',
      description: `${response.roles.length} role${response.roles.length === 1 ? '' : 's'} assigned to ${currentUser.email}.`,
      data: { intent: 'success' },
    })
  }

  const Panel = panels[current].component

  return (
    <>
      <div className={cx('byline-admin-user-grid', styles.grid)}>
        <div className={cx('byline-admin-user-column', styles.column)}>
          <ContainerSection title="Account Details" onEdit={openDrawer('update')}>
            <p className={cx('byline-admin-user-line', styles.line)}>
              <span className="muted">Email:</span> {currentUser.email}
            </p>
            <p className={cx('byline-admin-user-line', styles.line)}>
              <span className="muted">Given name:</span>{' '}
              {currentUser.given_name ?? (
                <span className={cx('muted byline-admin-user-not-set', styles.notSet)}>
                  Not set
                </span>
              )}
            </p>
            <p className={cx('byline-admin-user-line', styles.line)}>
              <span className="muted">Family name:</span>{' '}
              {currentUser.family_name ?? (
                <span className={cx('muted byline-admin-user-not-set', styles.notSet)}>
                  Not set
                </span>
              )}
            </p>
            <p className={cx('byline-admin-user-line', styles.line)}>
              <span className="muted">Username:</span>{' '}
              {currentUser.username ?? (
                <span className={cx('muted byline-admin-user-not-set', styles.notSet)}>
                  Not set
                </span>
              )}
            </p>
            <p className={cx('byline-admin-user-line', styles.line)}>
              <span className="muted">Super admin:</span>{' '}
              {currentUser.is_super_admin ? 'Yes' : 'No'}
            </p>
            <p className={cx('byline-admin-user-line', styles.line)}>
              <span className="muted">Email verified:</span>{' '}
              {currentUser.is_email_verified ? 'Yes' : 'No'}
            </p>
            <p className={cx('byline-admin-user-line-spaced', styles.lineSpaced)}>
              <span className="muted">Status:</span>{' '}
              <span
                className={cx({
                  'byline-admin-user-status-on': currentUser.is_enabled,
                  [styles.statusOn]: currentUser.is_enabled,
                  'byline-admin-user-status-off': !currentUser.is_enabled,
                  [styles.statusOff]: !currentUser.is_enabled,
                })}
              >
                {currentUser.is_enabled ? 'Enabled' : 'Disabled'}
              </span>
            </p>
            <Button size="sm" onClick={openDrawer('update')}>
              Update Details
            </Button>
            <div className={cx('muted byline-admin-user-meta', styles.meta)}>
              <p>
                <span className="font-bold">Created:&nbsp;</span>
                <LocalDateTime value={currentUser.created_at} />
              </p>
              <p>
                <span className="font-bold">Updated:&nbsp;</span>
                <LocalDateTime value={currentUser.updated_at} />
              </p>
              <p className={cx('byline-admin-user-line', styles.line)}>
                <span className="font-bold">Last login:&nbsp;</span>
                <LocalDateTime value={currentUser.last_login} fallback="Never" />
              </p>
            </div>
          </ContainerSection>
        </div>

        <div className={cx('byline-admin-user-column', styles.column)}>
          <ContainerSection title="Roles" onEdit={openDrawer('roles')}>
            {currentUserRoles.length === 0 ? (
              <p className={cx('muted byline-admin-user-role-empty', styles.roleEmpty)}>
                No roles assigned.
              </p>
            ) : (
              <div className={cx('byline-admin-user-role-list', styles.roleList)}>
                {currentUserRoles.map((role) => (
                  <RoleBadge key={role.id} role={role} />
                ))}
              </div>
            )}
            <Button size="sm" onClick={openDrawer('roles')}>
              Edit Roles
            </Button>
          </ContainerSection>

          <ContainerSection title="Password" onEdit={openDrawer('set_password')}>
            <p className={cx('byline-admin-user-line-spaced', styles.lineSpaced)}>
              Set a new password for this user.
            </p>
            <Button size="sm" onClick={openDrawer('set_password')}>
              Set Password
            </Button>
          </ContainerSection>

          <ContainerSection title="Delete Admin User">
            <p className={cx('byline-admin-user-line-spaced', styles.lineSpaced)}>
              Permanently delete this admin user.
            </p>
            <Button size="sm" intent="danger" onClick={openModal('delete_user')}>
              Delete Admin User
            </Button>
          </ContainerSection>
        </div>
      </div>

      <Drawer
        id="admin-user-drawer"
        closeOnOverlayClick={false}
        width="medium"
        topOffset="46px"
        isOpen={isDrawerOpen}
        onDismiss={closeDrawer}
        className={cx({
          'byline-admin-user-drawer-large': panels[current].drawerWidth === 'large',
          [styles.drawerLarge]: panels[current].drawerWidth === 'large',
          'byline-admin-user-drawer': panels[current].drawerWidth !== 'large',
          [styles.drawer]: panels[current].drawerWidth !== 'large',
        })}
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
            <div className={cx('byline-admin-user-drawer-scroll', styles.drawerScroll)}>
              {current === 'roles' ? (
                <UserRoles
                  user={currentUser}
                  allRoles={allRoles}
                  initialRoleIds={currentUserRoles.map((r) => r.id)}
                  onClose={closeDrawer}
                  onSaved={handleRolesSaved}
                />
              ) : (
                <Panel user={currentUser} onClose={closeDrawer} onSuccess={handleSuccess} />
              )}
            </div>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>

      <Modal isOpen={isModalOpen} onDismiss={closeModal} closeOnOverlayClick={false}>
        <Modal.Container className={cx('byline-admin-user-modal', styles.modal)}>
          <Modal.Header className={cx('byline-admin-user-modal-head', styles.modalHead)}>
            <h3 className="m-0">{panels[current].title}</h3>
            <IconButton aria-label="Close" size="sm" onClick={closeModal}>
              <CloseIcon width="14px" height="14px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Panel user={currentUser} onClose={closeModal} onSuccess={handleSuccess} />
        </Modal.Container>
      </Modal>
    </>
  )
}
