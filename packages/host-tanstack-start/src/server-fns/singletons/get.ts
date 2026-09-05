/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { readSingletonDocument } from '../singleton-document-read.js'

export interface GetSingletonInput {
  singleton: string
  locale?: string
  depth?: number
  populateRelations?: boolean
}

/**
 * Task 4 singleton-loader contract:
 *
 * - this shared host layer owns lenient reads, raw missing-locale values,
 *   relation-summary population, transport serialization, and preservation of
 *   restore warnings and locale metadata;
 * - the route loader composes the informational published-version badge, feature
 *   enablement, capability, and schedule aliases. Schedule state itself comes
 *   from the same editable snapshot as the source document.
 */
export const getSingleton = createServerFn({ method: 'GET' })
  .validator((input: GetSingletonInput) => input)
  .handler(async ({ data }) => readSingletonDocument(data))
