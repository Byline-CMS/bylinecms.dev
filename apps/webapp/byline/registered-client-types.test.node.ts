/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { BylineClient, RegisteredCollections } from '@byline/client'
import type { getViewerBylineClient } from '@byline/client/server'
import type { DocsFields as DocFields } from '@byline/generated-types'
import { describe, expectTypeOf, it } from 'vitest'

import type { BylineCollections } from './collections/index.js'

type AppClient = BylineClient<BylineCollections>

const getDoc = (client: AppClient) => client.collection('docs').findById('document-id')

describe('application Byline client types', () => {
  it('constrains collection paths to the inferred registry', () => {
    expectTypeOf<Parameters<AppClient['collection']>[0]>().toEqualTypeOf<
      keyof BylineCollections & string
    >()
  })

  it('infers the collection field shape from its path', () => {
    type InferredFields = NonNullable<Awaited<ReturnType<typeof getDoc>>>['fields']

    expectTypeOf<InferredFields>().toEqualTypeOf<DocFields>()
  })

  it('registers the generated registry on @byline/client via declaration merging', () => {
    // The generated file's `declare module '@byline/client'` block makes a
    // bare `BylineClient` — including the host getters' return type —
    // equivalent to the explicitly parameterised app client.
    expectTypeOf<RegisteredCollections>().toEqualTypeOf<BylineCollections>()
    expectTypeOf<ReturnType<typeof getViewerBylineClient>>().toEqualTypeOf<AppClient>()
  })
})
