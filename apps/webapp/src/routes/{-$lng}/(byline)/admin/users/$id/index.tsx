/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import { Container, Section } from '@infonomic/uikit/react'

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'
import { getAdminUser } from '@/modules/admin/admin-users'
import { AccountContainer } from '@/modules/admin/admin-users/components/account-container'

export const Route = createFileRoute('/{-$lng}/(byline)/admin/users/$id/')({
  loader: async ({ params }) => {
    try {
      const user = await getAdminUser({ data: { id: params.id } })
      return { user }
    } catch (err) {
      // Service emits `AdminUsersError(NOT_FOUND)` when the id resolves
      // to no row; TanStack Start wraps the error for the transport.
      // We map it to the framework `notFound()` so the route renders
      // the 404 boundary rather than the generic error boundary.
      // The service throws `AdminUsersError` with this code when the id
      // resolves to no row. Matching on the string avoids importing from
      // `@byline/admin` in a client-reachable module — the subpath pulls
      // argon2 into the browser bundle transitively.
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: unknown }).code === 'admin.users.notFound'
      ) {
        throw notFound()
      }
      throw err
    }
  },
  component: AdminUserDetail,
})

function displayNameFor(user: {
  given_name: string | null
  family_name: string | null
  email: string
}) {
  const parts = [user.given_name, user.family_name].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  )
  return parts.length > 0 ? parts.join(' ') : user.email
}

function AdminUserDetail() {
  const { user } = Route.useLoaderData()
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Dashboard', href: '/admin' },
          { label: 'Admin Users', href: '/admin/users' },
          { label: 'User', href: `/admin/users/${user.id}` },
        ]}
      />
      <Section className="py-5 pb-2">
        <Container>
          <h1 className="mb-2">{displayNameFor(user)}</h1>
        </Container>
      </Section>
      <Section>
        <Container>
          <AccountContainer user={user} />
        </Container>
      </Section>
    </>
  )
}
