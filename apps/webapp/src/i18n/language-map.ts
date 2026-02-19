/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
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
