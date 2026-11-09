/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { BylineError, ERR_VALIDATION, ErrorCodes } from '../../lib/errors.js'

/** Explain strict mutation-read failures while preserving unrelated DB errors. */
export function rethrowDocumentReconstructionError(error: unknown): never {
  if (
    error instanceof BylineError &&
    error.code === ErrorCodes.DATABASE &&
    error.details?.reason === 'document_reconstruction_failed'
  ) {
    throw ERR_VALIDATION({
      message:
        'These changes could not be saved because stored content no longer matches the current field definitions. Nothing was saved. Ask a developer to restore a compatible schema or migrate the affected content before trying again.',
      details: { reason: 'stored_content_requires_repair' },
      cause: error,
    })
  }
  throw error
}
