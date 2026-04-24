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

import { Button, CloseIcon, Drawer, EditIcon, IconButton, Modal } from '@infonomic/uikit/react'
import cx from 'classnames'

import { LocalDateTime } from '@/ui/components/local-date-time'
import type { AdminUserResponse } from '../index'

/**
 * Detail view for a single admin user, built around Infonomic's drawer
 * pattern: the main view shows cards for each editable area of the
 * record, and each "Edit" button opens a drawer containing the
 * sub-form. Destructive actions (delete) use a modal instead of a
 * drawer.
 *
 * Phase 5a renders the cards read-only with placeholder drawers —
 * AccountDetails / SetPassword / DeleteUser sub-components land in 5b
 * and will slot into the `components` registry below without the
 * container needing to change.
 */

type ComponentKey = 'account_details' | 'set_password' | 'delete_user' | 'empty'

interface PanelProps {
  user: AdminUserResponse
  onClose?: () => void
  onSuccess?: (user: AdminUserResponse) => void
}

function PlaceholderPanel({ onClose }: PanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="muted">
        This editor form lands in the next phase. The container, drawer plumbing, and save-bus
        wiring are already in place — the sub-component will slot in without changes here.
      </p>
      <Button size="sm" intent="secondary" onClick={onClose}>
        Close
      </Button>
    </div>
  )
}

const panels: Record<
  ComponentKey,
  { title: string; drawerWidth: 'medium' | 'large'; component: React.ComponentType<PanelProps> }
> = {
  account_details: {
    title: 'Account Details',
    drawerWidth: 'large',
    component: PlaceholderPanel,
  },
  set_password: {
    title: 'Set Password',
    drawerWidth: 'medium',
    component: PlaceholderPanel,
  },
  delete_user: {
    title: 'Delete Admin User',
    drawerWidth: 'medium',
    component: PlaceholderPanel,
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

export function AccountContainer({ user }: { user: AdminUserResponse }) {
  const [currentUser, setCurrentUser] = useState<AdminUserResponse>(user)
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

  const Panel = panels[current].component

  return (
    <>
      <div className="mb-12 gap-4 sm:grid sm:grid-cols-2">
        <div className="mb-4 flex flex-col gap-4">
          <ContainerSection title="Account Details" onEdit={openDrawer('account_details')}>
            <p className="mb-0">
              <span className="muted">Email:</span> {currentUser.email}
            </p>
            <p className="mb-0">
              <span className="muted">Given name:</span>{' '}
              {currentUser.given_name ?? <span className="muted italic">Not set</span>}
            </p>
            <p className="mb-0">
              <span className="muted">Family name:</span>{' '}
              {currentUser.family_name ?? <span className="muted italic">Not set</span>}
            </p>
            <p className="mb-0">
              <span className="muted">Username:</span>{' '}
              {currentUser.username ?? <span className="muted italic">Not set</span>}
            </p>
            <p className="mb-0">
              <span className="muted">Super admin:</span>{' '}
              {currentUser.is_super_admin ? 'Yes' : 'No'}
            </p>
            <p className="mb-0">
              <span className="muted">Email verified:</span>{' '}
              {currentUser.is_email_verified ? 'Yes' : 'No'}
            </p>
            <p className="mb-3">
              <span className="muted">Status:</span>{' '}
              <span className={currentUser.is_enabled ? 'text-green-600' : 'text-red-600'}>
                {currentUser.is_enabled ? 'Enabled' : 'Disabled'}
              </span>
            </p>
            <Button size="sm" onClick={openDrawer('account_details')}>
              Update Details
            </Button>
            <div className="muted mt-4">
              <p>
                <span className="font-bold">Created:&nbsp;</span>
                <LocalDateTime value={currentUser.created_at} />
              </p>
              <p>
                <span className="font-bold">Updated:&nbsp;</span>
                <LocalDateTime value={currentUser.updated_at} />
              </p>
              <p className="mb-0">
                <span className="font-bold">Last login:&nbsp;</span>
                <LocalDateTime value={currentUser.last_login} fallback="Never" />
              </p>
            </div>
          </ContainerSection>
        </div>

        <div className="flex flex-col gap-4">
          <ContainerSection title="Password" onEdit={openDrawer('set_password')}>
            <p className="mb-3">Set a new password for this user.</p>
            <Button size="sm" onClick={openDrawer('set_password')}>
              Set Password
            </Button>
          </ContainerSection>

          <ContainerSection title="Delete Admin User">
            <p className="mb-3">Permanently delete this admin user.</p>
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
        topOffset="50px"
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
              <Panel user={currentUser} onClose={closeDrawer} onSuccess={handleSuccess} />
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
          <Panel user={currentUser} onClose={closeModal} onSuccess={handleSuccess} />
        </Modal.Container>
      </Modal>
    </>
  )
}
