/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { Card, Container, Section } from '@infonomic/uikit/react'

import { BreadcrumbsClient } from '@/ui/breadcrumbs/breadcrumbs-client'

export const Route = createFileRoute('/{-$lng}/(byline)/admin/account/')({
  component: AdminAccountIndex,
})

function AdminAccountIndex() {
  const { user } = Route.useRouteContext()
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Dashboard', href: '/admin' },
          { label: 'Account', href: '/admin/account' },
        ]}
      />
      <Section className="py-6">
        <Container>
          <Card>
            <Card.Header>
              <Card.Title>Account</Card.Title>
              <Card.Description className="muted">
                Manage your own admin profile, password, and active sessions.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="font-semibold">Email</dt>
                <dd>{user.email}</dd>
                {user.given_name != null ? (
                  <>
                    <dt className="font-semibold">Given name</dt>
                    <dd>{user.given_name}</dd>
                  </>
                ) : null}
                {user.family_name != null ? (
                  <>
                    <dt className="font-semibold">Family name</dt>
                    <dd>{user.family_name}</dd>
                  </>
                ) : null}
                <dt className="font-semibold">Super admin</dt>
                <dd>{user.is_super_admin ? 'Yes' : 'No'}</dd>
              </dl>
              <p className="muted mt-4">
                Placeholder — the change-password form, profile editor, and session list will be
                wired to the account module once it lands.
              </p>
            </Card.Content>
          </Card>
        </Container>
      </Section>
    </>
  )
}
