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

export const Route = createFileRoute('/{-$lng}/(byline)/admin/roles/')({
  component: AdminRolesIndex,
})

function AdminRolesIndex() {
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Dashboard', href: '/admin' },
          { label: 'Admin Roles', href: '/admin/roles' },
        ]}
      />
      <Section className="py-6">
        <Container>
          <Card>
            <Card.Header>
              <Card.Title>Admin Roles</Card.Title>
              <Card.Description className="muted">
                Group abilities into roles and assign them to admin users.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <p className="muted">
                Placeholder — role CRUD, member assignment, and the ability checkbox tree will be
                wired to the admin-roles / admin-permissions commands once those modules land.
              </p>
            </Card.Content>
          </Card>
        </Container>
      </Section>
    </>
  )
}
