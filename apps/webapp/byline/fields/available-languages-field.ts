/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { GroupField } from '@byline/core'

import { contentLocales, type LocaleDefinition } from '../i18n.js'

type Options = Partial<Omit<GroupField, 'type' | 'fields'>> & {
  locales?: readonly LocaleDefinition[]
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

type AvailableLanguagesField<Opts extends Options> = Omit<GroupField, 'name' | 'fields'> & {
  name: WithOverride<Opts, 'name', string, 'availableLanguages'>
  fields: LocaleFields<
    WithOverride<Opts, 'locales', readonly LocaleDefinition[], typeof contentLocales>
  >
}

const builtInValidate = (value: Record<string, boolean> | undefined): string | undefined => {
  const hasSelection =
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).some(Boolean)
  if (!hasSelection) {
    return 'At least one language must be selected.'
  }
  return undefined
}

/**
 * Returns a `GroupField` that renders one checkbox per locale entry.
 * Validation requires at least one language to be selected; if the caller
 * supplies its own `validate`, the built-in rule runs first and the caller's
 * validator only runs when the built-in passes.
 *
 * @description This field is intended for use in a document's "Edit" view
 * to allow editors to specify which languages a document is available in.
 * It is orthogonal to the defined workflow system and is here as a 'signal'
 * to frontend websites / consumers - allowing them to implement their own
 * logic around content availability per language.
 *
 * @param options - Optional overrides. Accepts any `GroupField` property
 *   except `type` and `fields` (which are computed), plus a `locales` array
 *   that drives the generated checkbox set.
 */
export function availableLanguagesField<const Opts extends Options>(
  options: Opts = {} as Opts
): AvailableLanguagesField<Opts> {
  const { name, label, helpText, locales, validate: userValidate, ...rest } = options

  const validate = userValidate
    ? (value: any, data: Record<string, any>) => {
        const builtInError = builtInValidate(value)
        if (builtInError) return builtInError
        return userValidate(value, data)
      }
    : builtInValidate

  return {
    ...rest,
    name: (name ?? 'availableLanguages') as any,
    label: label ?? 'Published Languages',
    helpText: helpText ?? 'Select the languages this document is available in.',
    type: 'group',
    fields: (locales ?? contentLocales).map(({ code, label }) => ({
      name: code,
      label,
      type: 'checkbox' as const,
      optional: true,
    })) as any,
    validate,
  }
}
