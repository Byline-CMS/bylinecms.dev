/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { GroupField } from '@byline/core'

import { contentLocales } from '../i18n.js'

export interface LocaleEntry {
  code: string
  label: string
}

/**
 * Returns a `GroupField` that renders one checkbox per locale entry.
 * Validation requires at least one language to be selected.
 *
 * @param locales - Array of locale entries (code + label) to build checkboxes from.
 * @param overrides - Optional partial overrides for the generated field (name, label, helpText, etc.).
 */
export function availableLanguagesField(
  locales: LocaleEntry[] = contentLocales,
  overrides: Partial<Pick<GroupField, 'name' | 'label' | 'helpText'>> = {}
): GroupField {
  return {
    name: 'availableLanguages',
    label: 'Published Languages',
    type: 'group',
    helpText: 'Select the languages this document is available in.',
    ...overrides,
    fields: locales.map(({ code, label }) => ({
      name: code,
      label,
      type: 'checkbox' as const,
    })),
    validate: (value: Array<Record<string, boolean>> | undefined) => {
      const hasSelection =
        Array.isArray(value) && value.some((item) => Object.values(item).some(Boolean))
      if (!hasSelection) {
        return 'At least one language must be selected.'
      }
    },
  }
}
