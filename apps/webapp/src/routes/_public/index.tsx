/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, Link } from '@tanstack/react-router'

import { Container, Section } from '@infonomic/uikit/react'

export const Route = createFileRoute('/_public/')({
  component: Index,
})

function Index() {
  return (
    <Section className="py-6">
      <Container>
        <p>Link to admin area...</p>
        <Link to="/admin" className="underline">Go to admin</Link>
      </Container>
    </Section>
  )
}
