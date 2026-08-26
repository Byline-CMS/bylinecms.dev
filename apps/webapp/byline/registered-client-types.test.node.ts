/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { BylineClient, RegisteredCollections, RegisteredSingletons } from '@byline/client'
import type { getViewerBylineClient } from '@byline/client/server'
import type { DocsFields as DocFields } from '@byline/generated-types'
import { describe, expectTypeOf, it } from 'vitest'

import type { BylineCollections } from './collections/index.js'

type AppClient = BylineClient<BylineCollections>
type SingletonRegistry = { 'site-settings': { siteName: string } }
type TypedSingletonClient = BylineClient<BylineCollections, SingletonRegistry>

const getDoc = (client: AppClient) => client.collection('docs').findById('document-id')
const getSettings = (client: TypedSingletonClient) => client.singleton('site-settings').get()

const assertKindErrors = (client: TypedSingletonClient) => {
  client.collection(
    // @ts-expect-error — a singleton path cannot select a collection handle.
    'site-settings'
  )
  client.singleton(
    // @ts-expect-error — a collection path cannot select a singleton handle.
    'docs'
  )
}

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
    expectTypeOf<RegisteredSingletons>().toEqualTypeOf<{}>()
    expectTypeOf<ReturnType<typeof getViewerBylineClient>>().toEqualTypeOf<AppClient>()
  })

  it('infers singleton fields and exposes exactly the document-id-free surface', () => {
    type InferredFields = NonNullable<Awaited<ReturnType<typeof getSettings>>>['fields']
    type SingletonMethods = keyof ReturnType<TypedSingletonClient['singleton']>

    expectTypeOf<InferredFields>().toEqualTypeOf<{ siteName: string }>()
    expectTypeOf<SingletonMethods>().toEqualTypeOf<
      | 'get'
      | 'update'
      | 'changeStatus'
      | 'unpublish'
      | 'schedulePublish'
      | 'confirmScheduledPublish'
      | 'cancelScheduledPublish'
      | 'getScheduledPublish'
      | 'history'
      | 'findByVersion'
      | 'restoreVersion'
      | 'copyToLocale'
    >()
    expectTypeOf(assertKindErrors).toBeFunction()
  })
})
