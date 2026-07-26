/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

const SCRIPT_LOCALES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\p{Script=Thai}/u, 'th'],
  [/\p{Script=Hiragana}|\p{Script=Katakana}/u, 'ja'],
  [/\p{Script=Hangul}/u, 'ko'],
  [/\p{Script=Lao}/u, 'lo'],
  [/\p{Script=Khmer}/u, 'km'],
  [/\p{Script=Myanmar}/u, 'my'],
]

/** Return one canonical locale when `Intl.Segmenter` supports the candidate. */
export function canonicalSegmenterLocale(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined
  try {
    const canonical = Intl.getCanonicalLocales(candidate)[0]
    if (canonical == null) return undefined
    return Intl.Segmenter.supportedLocalesOf([canonical]).length > 0 ? canonical : undefined
  } catch {
    return undefined
  }
}

/** Script-based locale fallback for content without a usable declaration. */
export function detectSearchLocale(
  text: string,
  hanLocale: 'zh' | 'ja' = 'zh'
): string | undefined {
  for (const [pattern, locale] of SCRIPT_LOCALES) {
    if (pattern.test(text)) return locale
  }
  if (/\p{Script=Han}/u.test(text)) return hanLocale
  return undefined
}

/**
 * Declared locale wins, followed by script detection and the configured
 * platform fallback. Every returned locale is canonical and Segmenter-safe.
 */
export function resolveSearchLocale(
  text: string,
  declaredLocale: string | undefined,
  defaultLocale = 'en',
  hanLocale: 'zh' | 'ja' = 'zh'
): string {
  const declared = canonicalSegmenterLocale(declaredLocale)
  if (declared != null) return declared

  const detected = canonicalSegmenterLocale(detectSearchLocale(text, hanLocale))
  if (detected != null) return detected

  return canonicalSegmenterLocale(defaultLocale) ?? 'en'
}
