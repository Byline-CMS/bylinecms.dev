/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { runClassifyErrorContract } from '@byline/db-conformance'

import { classifyError } from './classify-error.js'

runClassifyErrorContract([
  {
    adapterName: 'postgres',
    classifyError,
    uniqueViolationError: {
      code: '23505',
      constraint: 'idx_document_paths_collection_locale_path',
    },
    nestedUniqueViolationError: {
      name: 'DrizzleQueryError',
      cause: {
        code: '23505',
        constraint: 'idx_document_paths_collection_locale_path',
      },
    },
    unrelatedError: { code: '23503' },
  },
])
