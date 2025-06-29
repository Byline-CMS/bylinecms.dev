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

import type { ListTypes } from '@byline/byline/outputs/zod-types/index'
import { createFileRoute } from '@tanstack/react-router'
import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'
import { CollectionView } from '@/modules/pages/list'

export const Route = createFileRoute('/collections/$collection/')({
  loader: async ({ params }): Promise<ListTypes[keyof ListTypes]> => {
    const response = await fetch(`http://localhost:3001/api/${params.collection}`)
    if (!response.ok) {
      throw new Error('Failed to fetch collection')
    }
    return response.json() // as ListTypes[typeof params.collection & keyof ListTypes]
  },
  component: Index,
})

function Index() {
  const data = Route.useLoaderData()
  return (
    <>
      <BreadcrumbsClient breadcrumbs={[{ label: 'Pages', href: '/collections/pages' }]} />
      <CollectionView data={data} />
    </>
  )
}
