/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export type LanguageMap = Record<string, { nativeName: string }>

// Determines which languages the UI can switch between, and
// therefore the languages available to language-menu.tsx
export const interfaceLanguageMap: LanguageMap = {
  en: { nativeName: 'English' },
  es: { nativeName: 'Español' },
}

// Determines which languages are available as translated content.
// NOTE: there must be a matching set of languages in
// @/i18n/settings.ts so that corresponding locale routes
// will work.
export const availableLanguageMap: LanguageMap = {
  en: { nativeName: 'English' },
  es: { nativeName: 'Español' },
}

export type AvailableLanguagesType = Record<string, boolean>
