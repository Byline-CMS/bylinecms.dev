/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { AccountSelfContainer } from '@byline/ui'
import { Container, Section } from '@infonomic/uikit/react'

import { getAccount } from '@/modules/admin/admin-account'
import { BreadcrumbsClient } from '@/ui/breadcrumbs/breadcrumbs-client'

export const Route = createFileRoute('/(byline)/admin/account/')({
  loader: async () => {
    // The slim `user` on the admin route's context (CurrentAdminUser)
    // doesn't carry `vid` or the createdAt/updatedAt/lastLogin
    // timestamps, so the self-service drawer needs the full row.
    const account = await getAccount({ data: {} })
    return { account }
  },
  component: AdminAccountIndex,
})

function displayNameFor(account: {
  given_name: string | null
  family_name: string | null
  email: string
}) {
  const parts = [account.given_name, account.family_name].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  )
  return parts.length > 0 ? parts.join(' ') : account.email
}

function AdminAccountIndex() {
  const { account } = Route.useLoaderData()
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Dashboard', href: '/admin' },
          { label: 'Account', href: '/admin/account' },
        ]}
      />
      <Section className="pb-2">
        <Container>
          <h1 className="mb-2">{displayNameFor(account)}</h1>
          <p className="muted">Manage your own profile and password.</p>
        </Container>
      </Section>
      <Section>
        <Container>
          <AccountSelfContainer account={account} />
        </Container>
      </Section>
    </>
  )
}
