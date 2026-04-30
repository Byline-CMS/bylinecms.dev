/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import { Container, Section } from '@infonomic/uikit/react'

import { RoleContainer } from '../admin-shell/admin-roles/container.js'
import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import {
  getRoleAbilities,
  type ListRegisteredAbilitiesResponse,
  listRegisteredAbilities,
} from '../server-fns/admin-permissions/index.js'
import { type AdminRoleResponse, getAdminRole } from '../server-fns/admin-roles/index.js'

interface LoaderData {
  role: AdminRoleResponse
  registered: ListRegisteredAbilitiesResponse
  initialAbilities: string[]
}

export function createAdminRoleEditRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    loader: async ({ params }: { params: { id: string } }): Promise<LoaderData> => {
      try {
        // Three independent reads — fetch in parallel so the role-detail
        // page lands ready to open the permissions editor without a
        // second waterfall.
        const [role, registered, currentAbilities] = await Promise.all([
          getAdminRole({ data: { id: params.id } }),
          listRegisteredAbilities(),
          getRoleAbilities({ data: { id: params.id } }),
        ])
        return { role, registered, initialAbilities: currentAbilities.abilities }
      } catch (err) {
        // Match on the string code rather than importing the error class —
        // the subpath would pull argon2 into the browser bundle transitively.
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          ((err as { code?: unknown }).code === 'admin.roles.notFound' ||
            (err as { code?: unknown }).code === 'admin.permissions.roleNotFound')
        ) {
          throw notFound()
        }
        throw err
      }
    },
    component: function AdminRoleEditComponent() {
      const { role, registered, initialAbilities } = Route.useLoaderData() as LoaderData
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
              <RoleContainer
                role={role}
                registered={registered}
                initialAbilities={initialAbilities}
              />
            </Container>
          </Section>
        </>
      )
    },
  })

  return Route
}
