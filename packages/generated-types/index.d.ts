/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/generated-types` — a deliberately empty declaration-merge
 * target.
 *
 * This package ships no types of its own. Each application's generated
 * collection types (`@byline/core/codegen`, written by the app's
 * `generate-types` script) declare their exports *into* this module:
 *
 * ```ts
 * declare module '@byline/generated-types' {
 *   export type NewsFields = { … }
 *   export type CollectionFieldsByPath = { … }
 *   // …
 * }
 * ```
 *
 * With the generated file in the app's TypeScript program, imports like
 *
 * ```ts
 * import type { NewsFields } from '@byline/generated-types'
 * ```
 *
 * resolve here and type-check against the app's own schema. Imports are
 * type-only, so nothing is loaded at runtime.
 *
 * Exactly one application per TypeScript program can augment this module
 * — declaration merging is global to the program, so two apps sharing a
 * tsconfig project would collide. One app per tsconfig (the supported
 * layout) is safe.
 */

export {}
