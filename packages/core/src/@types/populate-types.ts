/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pure type aliases for the populate DSL. The runtime orchestrator
 * (`populateDocuments`) lives in `services/populate.ts` and re-exports
 * these for backward compatibility, but they live here so other type
 * surfaces — notably `CollectionAdminConfig.preview.populate` — can
 * reference them without importing the services layer (which would
 * create a cycle, since `populate.ts` imports from this folder).
 */

/**
 * Per-field populate options. `select` names the target's fields to
 * load (merged with the target's identity field so UI always has a
 * label to render); `populate` nests for deeper relations.
 *
 * Use the `'*'` sub-spec shorthand instead when you want the full
 * target document — `select` is strictly for explicit field lists.
 */
export interface PopulateFieldOptions {
  select?: string[]
  populate?: PopulateMap
}

/**
 * Per-relation projection selector.
 *
 * - `true` → default projection (identity field only; metadata is free).
 * - `'*'`  → full document (every field loaded).
 * - `{ select: [...] }` or `{ populate: {...} }` → explicit options.
 */
export type PopulateFieldSpec = true | '*' | PopulateFieldOptions

/**
 * Top-level populate spec. Keys are relation field names (matched
 * anywhere in the source document's field tree, including inside
 * `group` / `array` / `blocks` structures).
 */
export type PopulateMap = Record<string, PopulateFieldSpec>

/**
 * Top-level populate spec. Three shapes:
 *
 *   - `true`        → populate every relation leaf encountered, with
 *                     default projection (identity only) at every level.
 *   - `'*'`         → populate every relation leaf, with full projection
 *                     at every level. Symmetric with the sub-spec `'*'`
 *                     shorthand.
 *   - `PopulateMap` → populate only the named relations, with per-field
 *                     projection selectors.
 */
export type PopulateSpec = true | '*' | PopulateMap
