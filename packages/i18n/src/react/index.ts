/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Single React-side barrel. Provider + hook + language switcher all
 * share one React Context identity by virtue of living behind this
 * single subpath export — splitting across more subpaths would risk
 * Vite `optimizeDeps` pre-bundling each subpath into a private copy of
 * the Context module, breaking provider/consumer identity (see the
 * `@byline/ui/src/react.ts` comment for the same trap in another
 * package).
 */

export { I18nContext } from './i18n-context.js'
export { I18nProvider } from './i18n-provider.js'
export { LanguageMenu } from './language-menu.js'
export { useTranslation } from './use-translation.js'
export type { I18nContextValue } from './i18n-context.js'
export type { I18nProviderProps } from './i18n-provider.js'
export type { LanguageMenuProps } from './language-menu.js'
export type { UseTranslationReturn } from './use-translation.js'
