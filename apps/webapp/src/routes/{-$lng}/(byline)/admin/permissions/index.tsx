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

export const Route = createFileRoute('/{-$lng}/(byline)/admin/permissions/')({
  component: AdminPermissionsIndex,
})

function AdminPermissionsIndex() {
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Dashboard', href: '/admin' },
          { label: 'Permissions', href: '/admin/permissions' },
        ]}
      />
      <Section className="py-6">
        <Container>
          <Card>
            <Card.Header>
              <Card.Title>Permissions</Card.Title>
              <Card.Description className="muted">
                Read-only inspector for every registered ability, grouped by subsystem.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <p className="muted">
                Placeholder — this view will enumerate the abilities registered through the
                framework's <code>AbilityRegistry</code> (collections auto-contribute their CRUD +
                workflow keys; admin and future plugins register their own), along with which roles
                currently hold each ability.
              </p>
            </Card.Content>
          </Card>
        </Container>
      </Section>
    </>
  )
}
