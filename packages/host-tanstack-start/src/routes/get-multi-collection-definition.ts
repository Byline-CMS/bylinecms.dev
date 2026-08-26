/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { MultiCollectionDefinition } from '@byline/core'
import { getCollectionDefinition, isSingleton } from '@byline/core'

/** Resolve only the resource kind supported by the collection route family. */
export function getMultiCollectionDefinition(path: string): MultiCollectionDefinition | null {
  const definition = getCollectionDefinition(path)
  return definition != null && !isSingleton(definition) ? definition : null
}
