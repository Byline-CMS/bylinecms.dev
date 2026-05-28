/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/i18n` — admin interface translation primitives.
 *
 * Root entry: pure, React-free, safe to import from server contexts
 * (loaders, server fns, Workers). Carries the type definitions, the
 * `mergeTranslations` registry helper, the ICU formatter, and the
 * locale-resolution cascade.
 *
 * The React surface (`<I18nProvider>`, `useTranslation`,
 * `<LanguageMenu>`) lives at `@byline/i18n/react` — single barrel,
 * single React Context identity, to sidestep the Vite `optimizeDeps`
 * trap that has bitten this codebase before (see `@byline/ui`'s
 * `react.ts` comment).
 *
 * Admin bundles (`adminTranslations(...)`, the English bundle) live
 * at `@byline/i18n/admin`.
 *
 * See `docs/I18N.md` for the architecture.
 */

export { createFormatter } from './formatter.js'
export { mergeTranslations } from './merge.js'
export { resolveInterfaceLocale } from './resolve.js'
export type {
  Formatter,
  FormatterOptions,
  MissingTranslationEvent,
} from './formatter.js'
export type { MergeOptions, TranslationCollision } from './merge.js'
export type { ResolveInterfaceLocaleOptions } from './resolve.js'
export type {
  LocaleCode,
  LocaleDefinition,
  MessageKey,
  Namespace,
  NamespaceTranslations,
  TranslationBundle,
  TranslationValues,
} from './types.js'
