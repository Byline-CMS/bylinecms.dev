/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { Card, Container, Section } from '@infonomic/uikit/react'

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'

export const Route = createFileRoute('/{-$lng}/(byline)/admin/users/')({
  component: AdminUsersIndex,
})

function AdminUsersIndex() {
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Dashboard', href: '/admin' },
          { label: 'Admin Users', href: '/admin/users' },
        ]}
      />
      <Section className="py-6">
        <Container>
          <Card>
            <Card.Header>
              <Card.Title>Admin Users</Card.Title>
              <Card.Description className="muted">
                Manage the accounts that can sign in to the CMS.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <p className="muted">
                Placeholder — the list, create, edit, enable/disable, and delete UI will be wired to
                the admin-user commands from <code>@byline/admin/admin-users</code> in the next
                step.
              </p>
            </Card.Content>
          </Card>
        </Container>
      </Section>
    </>
  )
}
