/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Field path grammar — one AST, two serialisations.
 *
 * See `path-types.ts` for the instance/declaration model, and
 * `docs/04-collections/01-fields.md` for the author-facing account.
 */

export {
  formatDeclarationPath,
  formatInstancePath,
  parseDeclarationPath,
  parseInstancePath,
  toDeclarationSegments,
} from './parse-path.js'
export { resolveDeclarationPath, walkFieldDeclarations } from './resolve-path.js'
export type {
  PathParseFailure,
  PathParseResult,
  PathResolution,
  PathSegment,
  ResolveOptions,
} from './path-types.js'
