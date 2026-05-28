/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * ICU MessageFormat layer over a `TranslationBundle`. The expensive
 * step in `intl-messageformat` is parsing the message string into its
 * AST; once parsed, formatting against `values` is cheap. We cache the
 * formatter by `(locale, namespace, key)` so a re-render that calls
 * `t('foo')` a hundred times pays the parse cost exactly once.
 *
 * `createFormatter` returns a pure object: no React, no DOM, safe to
 * use from server-side loaders, server functions, and Workers. The
 * React hook in `./react` is a thin context wrapper around this.
 *
 * Fallback chain on lookup:
 *   1. `bundle[activeLocale][namespace][key]`
 *   2. `bundle[defaultLocale][namespace][key]`
 *   3. The raw key — loud-by-default so missing translations are
 *      visible in the UI during development.
 *
 * A miss in step 1 (but hit in step 2) invokes `onMissing` once per
 * `(locale, namespace, key)` triple — the formatter dedups internally
 * so repeated renders don't spam the console.
 */

import { IntlMessageFormat } from 'intl-messageformat'

import type {
  LocaleCode,
  MessageKey,
  Namespace,
  TranslationBundle,
  TranslationValues,
} from './types.js'

export interface FormatterOptions {
  bundle: TranslationBundle
  /** The locale to look up first. */
  activeLocale: LocaleCode
  /** Last-resort lookup before falling back to the raw key. */
  defaultLocale: LocaleCode
  /**
   * Invoked once per `(locale, namespace, key)` triple when step 1
   * misses but step 2 hits. Used by the React provider to emit
   * `console.warn` lines in development. Pass `undefined` to suppress.
   */
  onMissing?: (event: MissingTranslationEvent) => void
}

export interface MissingTranslationEvent {
  activeLocale: LocaleCode
  namespace: Namespace
  key: MessageKey
  /** Whether the default-locale lookup also missed. */
  fellThroughToKey: boolean
}

export interface Formatter {
  /**
   * Format a message for `namespace.key` with `values`. Always returns
   * a string. ICU error paths (malformed message, missing required
   * argument) fall through to the raw key rather than throwing — the
   * admin shell should never crash because of a translation bug.
   */
  t(namespace: Namespace, key: MessageKey, values?: TranslationValues): string
  readonly activeLocale: LocaleCode
  readonly defaultLocale: LocaleCode
}

export function createFormatter(options: FormatterOptions): Formatter {
  const { bundle, activeLocale, defaultLocale, onMissing } = options

  // Cache key shape: `${locale}\0${namespace}\0${key}`. Null bytes
  // separate the components so locales / namespaces / keys that happen
  // to contain `:` or `.` (common in translation tooling) can't collide.
  const formatterCache = new Map<string, IntlMessageFormat | null>()
  const missingReported = new Set<string>()

  function lookupMessage(
    locale: LocaleCode,
    namespace: Namespace,
    key: MessageKey
  ): string | undefined {
    return bundle[locale]?.[namespace]?.[key]
  }

  function getFormatter(
    locale: LocaleCode,
    namespace: Namespace,
    key: MessageKey
  ): IntlMessageFormat | null {
    const cacheKey = `${locale}\0${namespace}\0${key}`
    const cached = formatterCache.get(cacheKey)
    if (cached !== undefined) return cached
    const message = lookupMessage(locale, namespace, key)
    if (message == null) {
      formatterCache.set(cacheKey, null)
      return null
    }
    try {
      const formatter = new IntlMessageFormat(message, locale)
      formatterCache.set(cacheKey, formatter)
      return formatter
    } catch {
      // Malformed message — cache the null so we don't re-parse on
      // every render. The caller falls through to the next tier.
      formatterCache.set(cacheKey, null)
      return null
    }
  }

  function reportMissing(namespace: Namespace, key: MessageKey, fellThroughToKey: boolean): void {
    if (onMissing == null) return
    const reportKey = `${activeLocale}\0${namespace}\0${key}\0${fellThroughToKey ? '1' : '0'}`
    if (missingReported.has(reportKey)) return
    missingReported.add(reportKey)
    onMissing({ activeLocale, namespace, key, fellThroughToKey })
  }

  return {
    activeLocale,
    defaultLocale,
    t(namespace, key, values) {
      // Tier 1 — active locale.
      const activeFormatter = getFormatter(activeLocale, namespace, key)
      if (activeFormatter != null) {
        return formatSafe(activeFormatter, values, key)
      }

      // Tier 2 — default locale.
      if (defaultLocale !== activeLocale) {
        const defaultFormatter = getFormatter(defaultLocale, namespace, key)
        if (defaultFormatter != null) {
          reportMissing(namespace, key, false)
          return formatSafe(defaultFormatter, values, key)
        }
      }

      // Tier 3 — raw key. Loud-by-default.
      reportMissing(namespace, key, true)
      return key
    },
  }
}

function formatSafe(
  formatter: IntlMessageFormat,
  values: TranslationValues | undefined,
  fallbackKey: MessageKey
): string {
  try {
    const out = formatter.format(values as Record<string, unknown> | undefined)
    // `format` can return an array when rich-element interpolation is
    // used. Phase 1 narrows the public API to string values only, so
    // the array path shouldn't fire — but if it does, fall back to the
    // raw key rather than returning `[object Object]`.
    return typeof out === 'string' ? out : fallbackKey
  } catch {
    return fallbackKey
  }
}
