/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionRegistry } from '@byline/core'

/**
 * Application type registration point (the TanStack Router / Payload
 * "Register" pattern). `@byline/core/codegen` appends a declaration-merge
 * block to the app's generated collection types:
 *
 * ```ts
 * declare module '@byline/client' {
 *   interface Register {
 *     collections: CollectionFieldsByPath
 *     singletons: SingletonFieldsByPath
 *   }
 * }
 * ```
 *
 * Once merged, every bare `BylineClient` in the app's program — including
 * the getters on `@byline/client/server` — resolves to
 * `BylineClient<CollectionFieldsByPath, SingletonFieldsByPath>`, so
 * `client.collection('news')` and `client.singleton('site-settings')`
 * autocomplete their respective paths and return the generated field shapes
 * with no per-call generics and no type assertions.
 *
 * Exactly one application per TypeScript program can augment this
 * interface: declaration merging is global to the program, so two apps
 * sharing a tsconfig project would collide. One app per tsconfig (the
 * supported layout) is safe.
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merge target
export interface Register {}

/**
 * The app's registered collection registry, or the loose
 * `CollectionRegistry` fallback when no augmentation is present. The
 * fallback keeps unaugmented consumers — downstream apps that haven't
 * migrated, scripts compiled outside the app program, this package's own
 * tests — compiling exactly as before.
 */
export type RegisteredCollections = Register extends {
  collections: infer TCollections extends CollectionRegistry
}
  ? TCollections
  : CollectionRegistry

/**
 * The app's registered singleton registry, or the same loose
 * `CollectionRegistry` fallback used by collections when no augmentation is
 * present. Keeping this as a conditional lookup preserves the deliberately
 * empty declaration-merge target above.
 */
export type RegisteredSingletons = Register extends {
  singletons: infer TSingletons extends CollectionRegistry
}
  ? TSingletons
  : CollectionRegistry
