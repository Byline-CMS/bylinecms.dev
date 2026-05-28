/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Merge any number of `TranslationBundle`s into a single immutable
 * registry. Last writer wins at the `(locale, namespace, key)` grain;
 * collisions are reported via the optional `onCollision` callback
 * (called once per replaced key) so callers can wire dev-mode warnings.
 *
 * Associative and deterministic — `merge(a, merge(b, c))` produces the
 * same result as `merge(merge(a, b), c)`. Empty / undefined inputs are
 * accepted and produce identity behaviour, so callers don't need
 * conditional branching when a locale bundle is absent.
 */

import type { LocaleCode, MessageKey, Namespace, TranslationBundle } from './types.js'

export interface MergeOptions {
  /**
   * Invoked once per collision (where a later bundle overrides an
   * earlier bundle's value). Pure side effect — used by callers to
   * emit `console.warn` lines in development. Production hosts can
   * pass `undefined` to suppress.
   */
  onCollision?: (collision: TranslationCollision) => void
}

export interface TranslationCollision {
  locale: LocaleCode
  namespace: Namespace
  key: MessageKey
  /** The value that was already present and is being overwritten. */
  previousValue: string
  /** The value that replaces it. */
  nextValue: string
}

/**
 * Plain `Record<...>` mirror of `TranslationBundle` used internally
 * while building up the merged registry. The public type is `Readonly`
 * everywhere; we only freeze at the end.
 */
type MutableBundle = {
  [locale: LocaleCode]: {
    [namespace: Namespace]: { [key: MessageKey]: string }
  }
}

export function mergeTranslations(
  ...bundles: Array<TranslationBundle | undefined>
): TranslationBundle
export function mergeTranslations(
  options: MergeOptions,
  ...bundles: Array<TranslationBundle | undefined>
): TranslationBundle
export function mergeTranslations(
  first: MergeOptions | TranslationBundle | undefined,
  ...rest: Array<TranslationBundle | undefined>
): TranslationBundle {
  let options: MergeOptions = {}
  let bundles: Array<TranslationBundle | undefined>
  if (isMergeOptions(first)) {
    options = first
    bundles = rest
  } else {
    bundles = [first, ...rest]
  }

  const out: MutableBundle = {}
  for (const bundle of bundles) {
    if (bundle == null) continue
    for (const locale of Object.keys(bundle)) {
      const localeBundle = bundle[locale]
      if (localeBundle == null) continue
      let targetLocale = out[locale]
      if (targetLocale == null) {
        targetLocale = {}
        out[locale] = targetLocale
      }
      for (const namespace of Object.keys(localeBundle)) {
        const namespaceBundle = localeBundle[namespace]
        if (namespaceBundle == null) continue
        let targetNs = targetLocale[namespace]
        if (targetNs == null) {
          targetNs = {}
          targetLocale[namespace] = targetNs
        }
        for (const key of Object.keys(namespaceBundle)) {
          const nextValue = namespaceBundle[key]
          if (nextValue == null) continue
          const previousValue = targetNs[key]
          if (previousValue !== undefined && previousValue !== nextValue) {
            options.onCollision?.({
              locale,
              namespace,
              key,
              previousValue,
              nextValue,
            })
          }
          targetNs[key] = nextValue
        }
      }
    }
  }

  return freezeBundle(out)
}

function isMergeOptions(value: unknown): value is MergeOptions {
  // Bundles are locale-keyed at the top level (`{ en: {...}, fr: {...} }`)
  // and their values are objects. MergeOptions has the `onCollision` key —
  // a function — and no nested object-shaped sibling keys. Discriminate by
  // looking for that function specifically; any object that isn't a bundle-
  // shaped record falls through to the bundles path.
  if (value == null || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj.onCollision === 'function'
}

function freezeBundle(bundle: MutableBundle): TranslationBundle {
  for (const locale of Object.keys(bundle)) {
    const localeBundle = bundle[locale]
    for (const namespace of Object.keys(localeBundle)) {
      Object.freeze(localeBundle[namespace])
    }
    Object.freeze(localeBundle)
  }
  return Object.freeze(bundle) as TranslationBundle
}
