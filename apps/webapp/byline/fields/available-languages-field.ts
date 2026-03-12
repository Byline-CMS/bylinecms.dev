/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { contentLocales, type LocaleDefinition } from '../i18n.js'

type Options = {
  name?: string
  label?: string
  helpText?: string
  locales?: LocaleDefinition[]
}

type LocaleFields<T extends readonly LocaleDefinition[]> = {
  [K in keyof T]: {
    name: T[K]['code']
    label: T[K]['label']
    type: 'checkbox'
    optional: true
  }
}

type WithOverride<O, K extends string, V, D> = O extends { [P in K]: V } ? O[K] : D

type AvailableLanguagesField<Opts> = {
  name: WithOverride<Opts, 'name', string, 'availableLanguages'>
  label: string
  helpText: string
  type: 'group'
  fields: LocaleFields<WithOverride<Opts, 'locales', LocaleDefinition[], typeof contentLocales>>
  validate: (value: Record<string, boolean> | undefined) => string | undefined
}

/**
 * Returns a `GroupField` that renders one checkbox per locale entry.
 * Validation requires at least one language to be selected.
 *
 * @description This field is intended for use in a document's "Edit" view
 * to allow editors to specify which languages a document is available in.
 * It is orthogonal to the defined workflow system and is here as a 'signal'
 * to frontend websites / consumers - allowing them to implement their own
 * logic around content availability per language.
 *
 * @param options - Optional overrides for the generated field (name, label, helpText, locales).
 */
export function availableLanguagesField<const Opts extends Options>(
  options: Opts = {} as Opts
): AvailableLanguagesField<Opts> {
  return {
    name: (options.name ?? 'availableLanguages') as any,
    label: options.label ?? 'Published Languages',
    helpText: options.helpText ?? 'Select the languages this document is available in.',
    type: 'group',
    fields: (options.locales ?? contentLocales).map(({ code, label }) => ({
      name: code,
      label,
      type: 'checkbox' as const,
      optional: true,
    })) as any,
    validate: (value: Record<string, boolean> | undefined) => {
      const hasSelection =
        value != null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.values(value).some(Boolean)
      if (!hasSelection) {
        return 'At least one language must be selected.'
      }
    },
  }
}
