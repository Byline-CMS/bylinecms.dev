/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { createFileRoute, Link } from '@tanstack/react-router'

import { getClientConfig } from '@byline/core'
import { Card, Container, Section } from '@infonomic/uikit/react'

export const Route = createFileRoute('/admin/')({
  component: Index,
})

function Index() {
  const config = getClientConfig()
  return (
    <Section className="py-6">
      <Container>
        <div className="grid grid-cols-auto-fit-320 gap-6">
          {config.collections.map((collection) => (
            <Card asChild key={collection.path} hover={true}>
              <Link
                to="/admin/collections/$collection"
                params={{ collection: collection.path }}
                className="block"
              >
                <Card.Header>
                  <Card.Title>{collection.labels.plural}</Card.Title>
                  <Card.Description>{`${collection.labels.plural} collection`}</Card.Description>
                </Card.Header>
                <Card.Content>
                  <p>{collection.labels.plural} collection description or stats here...</p>
                </Card.Content>
              </Link>
            </Card>
          ))}
        </div>
      </Container>
    </Section>
  )
}
