/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  buildRelationProjections,
  type FieldSet,
  getCollectionAdminConfig,
  getCollectionDefinition,
  type RelationProjections,
} from '@byline/core'

/**
 * Compute the relation-summary projections for a collection's fields from
 * the admin configs registered in the loader's runtime. Route loaders send
 * the result to the read server functions: the `_byline` route registers the
 * admin config before any loader runs, in the browser and during SSR alike,
 * whereas the server's own registry is filled only after its runtime has
 * rendered an admin route.
 */
export function getRelationProjections(fields: FieldSet): RelationProjections {
  return buildRelationProjections(fields, (targetPath) => ({
    def: getCollectionDefinition(targetPath),
    admin: getCollectionAdminConfig(targetPath),
  }))
}
