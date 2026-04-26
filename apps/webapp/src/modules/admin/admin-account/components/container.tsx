'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Self-service account container.
 *
 * Same drawer pattern as `admin-users/components/container.tsx` but
 * narrower: only Profile and Password sections (no Roles, no
 * Delete) — those are admin-only actions on someone else, not
 * self-service. Each card surfaces the read-only summary plus an
 * "Edit" affordance that opens the matching drawer.
 *
 * Forms lift the fresh `AccountResponse` back into local state on
 * success so the container's bumped `vid` is in hand for any
 * subsequent edit without a refetch.
 */

import type React from 'react'
import { useState } from 'react'

import { Button, CloseIcon, Drawer, EditIcon, IconButton } from '@infonomic/uikit/react'

import { LocalDateTime } from '@/ui/components/local-date-time'
import { ChangeAccountPassword } from './change-password'
import { UpdateAccount } from './update'
import type { AccountResponse } from '../index'

type ComponentKey = 'update' | 'change_password' | 'empty'

interface PanelProps {
  account: AccountResponse
  onClose?: () => void
  onSuccess?: (account: AccountResponse) => void
}

const panels: Record<ComponentKey, { title: string; component: React.ComponentType<PanelProps> }> =
{
  update: { title: 'Profile', component: UpdateAccount },
  change_password: { title: 'Change Password', component: ChangeAccountPassword },
  empty: { title: '', component: () => null },
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

interface AccountSelfContainerProps {
  account: AccountResponse
}

export function AccountSelfContainer({ account }: AccountSelfContainerProps) {
  const [currentAccount, setCurrentAccount] = useState<AccountResponse>(account)
  const [current, setCurrent] = useState<ComponentKey>('empty')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const openDrawer = (key: ComponentKey) => () => {
    setCurrent(key)
    setIsDrawerOpen(true)
  }
  const closeDrawer = () => {
    setCurrent('empty')
    setIsDrawerOpen(false)
  }
  const handleSuccess = (updated: AccountResponse) => {
    setCurrentAccount(updated)
  }

  const Panel = panels[current].component

  return (
    <>
      <div className="mb-12 gap-4 sm:grid sm:grid-cols-2">
        <div className="mb-4 flex flex-col gap-4">
          <ContainerSection title="Profile" onEdit={openDrawer('update')}>
            <p className="mb-0">
              <span className="muted">Email:</span> {currentAccount.email}
            </p>
            <p className="mb-0">
              <span className="muted">Given name:</span>{' '}
              {currentAccount.given_name ?? <span className="muted italic">Not set</span>}
            </p>
            <p className="mb-0">
              <span className="muted">Family name:</span>{' '}
              {currentAccount.family_name ?? <span className="muted italic">Not set</span>}
            </p>
            <p className="mb-3">
              <span className="muted">Username:</span>{' '}
              {currentAccount.username ?? <span className="muted italic">Not set</span>}
            </p>
            <Button size="sm" onClick={openDrawer('update')}>
              Edit Profile
            </Button>
            <div className="muted mt-4 text-xs">
              <p>
                <span className="font-bold">Created:&nbsp;</span>
                <LocalDateTime value={currentAccount.created_at} />
              </p>
              <p>
                <span className="font-bold">Updated:&nbsp;</span>
                <LocalDateTime value={currentAccount.updated_at} />
              </p>
              <p className="mb-0">
                <span className="font-bold">Last login:&nbsp;</span>
                <LocalDateTime value={currentAccount.last_login} fallback="Never" />
              </p>
            </div>
          </ContainerSection>
        </div>

        <div className="flex flex-col gap-4">
          <ContainerSection title="Password" onEdit={openDrawer('change_password')}>
            <p className="mb-3">
              Change the password used to sign in to the admin. You'll need to enter your current
              password to confirm the change.
            </p>
            <Button size="sm" onClick={openDrawer('change_password')}>
              Change Password
            </Button>
          </ContainerSection>

          <ContainerSection title="Account Status">
            <p className="mb-0">
              <span className="muted">Super admin:</span>{' '}
              {currentAccount.is_super_admin ? 'Yes' : 'No'}
            </p>
            <p className="mb-0">
              <span className="muted">Email verified:</span>{' '}
              {currentAccount.is_email_verified ? 'Yes' : 'No'}
            </p>
            <p className="mb-0">
              <span className="muted">Status:</span>{' '}
              <span className={currentAccount.is_enabled ? 'text-green-600' : 'text-red-600'}>
                {currentAccount.is_enabled ? 'Enabled' : 'Disabled'}
              </span>
            </p>
            <p className="muted mt-3 mb-0 text-xs">
              These flags are managed by an admin with the appropriate permissions and are not
              self-editable.
            </p>
          </ContainerSection>
        </div>
      </div>

      <Drawer
        id="admin-account-drawer"
        closeOnOverlayClick={false}
        width="medium"
        topOffset="46px"
        isOpen={isDrawerOpen}
        onDismiss={closeDrawer}
        className="md:w-[500px]"
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
              <Panel account={currentAccount} onClose={closeDrawer} onSuccess={handleSuccess} />
            </div>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>
    </>
  )
}
