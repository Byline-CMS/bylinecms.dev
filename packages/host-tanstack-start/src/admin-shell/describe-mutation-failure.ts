/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { getDocumentFieldValidationDetails } from '@byline/core'
import type { TranslationValues } from '@byline/i18n'

/**
 * Describe a failed document mutation for the editor.
 *
 * Content writes that are not restores — create, update, patch saves,
 * duplication and locale copies — keep the field-validation gate, because each
 * reads or authors content the editor can open and correct. Naming the
 * offending fields is what makes that correction actionable; without it the
 * editor sees only a generic failure.
 */
export function describeMutationFailure(
  err: unknown,
  t: (key: string, values?: TranslationValues) => string
): string {
  const validation = getDocumentFieldValidationDetails(err)
  if (validation == null) return t('documentConcurrency.failed')
  return t('collections.edit.invalidFieldsMessage', {
    fields: validation.issues.map((issue) => issue.field || '?').join(', '),
  })
}
