/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Map a stable validation-error code (emitted by a `@byline/core/validation`
 * schema) onto its translation. Returns the original input unchanged when
 * the code is not in the map, so non-coded error messages (free-form
 * Zod messages, server-supplied strings) pass through.
 *
 * Why a separate translator: `@byline/core` stays i18n-agnostic — schemas
 * emit codes, not text — so it has no dependency on `@byline/i18n` or
 * any locale data. This package owns the translation surface and keeps
 * the mapping in one place, so callers across the admin shell don't
 * each maintain their own code-to-key lookup.
 *
 * Adding a new code: extend the source schema in `@byline/core/validation`
 * and add the matching key here.
 */

import type { UseTranslationReturn } from '@byline/i18n/react'

type Translate = UseTranslationReturn['t']

/**
 * Maps validation error codes from `@byline/core/validation` schemas to
 * their corresponding `byline-admin` translation keys.
 */
const VALIDATION_CODE_KEYS: Record<string, string> = {
  'password.tooShort': 'validation.password.tooShort',
  'password.tooLong': 'validation.password.tooLong',
  'password.complexity': 'validation.password.complexity',
}

/**
 * Translate a validation error code into the active locale's message.
 *
 * Pass the raw error string straight out of Zod (e.g. via
 * `firstError(field.state.meta.errors)`). When the string matches a
 * known code, the corresponding translation is returned; otherwise the
 * input flows through unchanged.
 *
 * Designed for the `errorText={…}` slot on form inputs.
 */
export function translateValidationError(
  t: Translate,
  message: string | undefined
): string | undefined {
  if (message == null) return message
  const key = VALIDATION_CODE_KEYS[message]
  return key ? t(key) : message
}
