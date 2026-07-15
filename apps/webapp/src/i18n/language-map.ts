export type LanguageMap = Record<string, { nativeName: string }>

// The host **frontend** interface locales — the languages the public
// chrome can switch between, and therefore what language-menu.tsx lists.
// Host-owned and NOT derivable from Byline: Byline's *admin* interface set
// (`byline/i18n.ts` → interfaceLocales, `en`/`fr`) is a deliberately
// different set. Keep in sync with `i18nConfig.locales` (`src/i18n/i18n-config.ts`).
//
// The *content* locale labels (which languages a document can be published
// in) are NOT defined here — `i18n-config.ts` derives and exports them from
// Byline's client-safe `byline/public.ts` barrel, so there is no parallel map
// to drift.
export const interfaceLanguageMap: LanguageMap = {
  en: { nativeName: 'English' },
  fr: { nativeName: 'Français' },
}
