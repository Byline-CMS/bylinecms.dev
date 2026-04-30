/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import { AccountContainer } from '@byline/host-tanstack-start/admin-shell/admin-users/container'
import { BreadcrumbsClient } from '@byline/host-tanstack-start/admin-shell/chrome/breadcrumbs/breadcrumbs-client'
import { listAdminRoles } from '@byline/host-tanstack-start/server-fns/admin-roles'
import { getAdminUser, getUserRoles } from '@byline/host-tanstack-start/server-fns/admin-users'
import { Container, Section } from '@infonomic/uikit/react'

export const Route = createFileRoute('/(byline)/admin/users/$id/')({
  loader: async ({ params }) => {
    try {
      // Three independent reads in parallel — the user row, the full
      // role catalog (for the roles drawer's checkbox list), and the
      // user's current role assignments.
      const [user, rolesList, userRoles] = await Promise.all([
        getAdminUser({ data: { id: params.id } }),
        listAdminRoles(),
        getUserRoles({ data: { userId: params.id } }),
      ])
      return { user, allRoles: rolesList.roles, initialUserRoles: userRoles.roles }
    } catch (err) {
      // Service emits `AdminUsersError(NOT_FOUND)` when the id resolves
      // to no row; the user-roles command uses
      // `admin.roles.userNotFound` for the same condition. Map either
      // to the framework `notFound()` so the route renders the 404
      // boundary rather than the generic error boundary. Matching on
      // the string avoids importing from `@byline/admin` in a
      // client-reachable module — the subpath pulls argon2 into the
      // browser bundle transitively.
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        ((err as { code?: unknown }).code === 'admin.users.notFound' ||
          (err as { code?: unknown }).code === 'admin.roles.userNotFound')
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
  const { user, allRoles, initialUserRoles } = Route.useLoaderData()
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
          <AccountContainer user={user} allRoles={allRoles} initialUserRoles={initialUserRoles} />
        </Container>
      </Section>
    </>
  )
}
