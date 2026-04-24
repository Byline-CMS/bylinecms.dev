/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import { Container, Section } from '@infonomic/uikit/react'

import { getAdminRole } from '@/modules/admin/admin-roles'
import { RoleContainer } from '@/modules/admin/admin-roles/components/container'
import { BreadcrumbsClient } from '@/ui/breadcrumbs/breadcrumbs-client'

export const Route = createFileRoute('/{-$lng}/(byline)/admin/roles/$id/')({
  loader: async ({ params }) => {
    try {
      const role = await getAdminRole({ data: { id: params.id } })
      return { role }
    } catch (err) {
      // Match on the string code rather than importing the error class —
      // the subpath would pull argon2 into the browser bundle transitively.
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: unknown }).code === 'admin.roles.notFound'
      ) {
        throw notFound()
      }
      throw err
    }
  },
  component: AdminRoleDetail,
})

function AdminRoleDetail() {
  const { role } = Route.useLoaderData()
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Dashboard', href: '/admin' },
          { label: 'Admin Roles', href: '/admin/roles' },
          { label: 'Role', href: `/admin/roles/${role.id}` },
        ]}
      />
      <Section className="py-5 pb-2">
        <Container>
          <h1 className="mb-2">{role.name}</h1>
        </Container>
      </Section>
      <Section>
        <Container>
          <RoleContainer role={role} />
        </Container>
      </Section>
    </>
  )
}
