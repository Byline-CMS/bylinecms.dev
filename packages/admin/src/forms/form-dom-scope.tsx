'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ReactNode } from 'react'
import { createContext, useContext, useId } from 'react'

/**
 * Per-form-instance prefix for derived DOM ids.
 *
 * Field widgets derive an element id from the field's path, and tab strips derive
 * theirs from the tab-set name. Both are unique within one form and identical
 * between two forms editing the same collection. Mount a second form — the
 * relationship picker's creation view does exactly that — and every `label`'s
 * `for`, every `aria-describedby` and every `aria-labelledby` resolves to whichever
 * element the browser happens to see first, which is the parent form's. The reader
 * then gets the wrong label announced and a click on a label focuses a field in a
 * different form.
 *
 * `null` rather than `''` as the default so `useFormDomScope` can tell "no provider
 * above me" from "a provider that produced an empty scope", even though both
 * currently degrade to the same unprefixed id.
 */
const FormDomScopeContext = createContext<string | null>(null)

/**
 * Establishes one DOM id scope. `FormProvider` wraps its children in this, so a
 * scope exists wherever form state does and no caller has to opt in.
 */
export const FormDomScopeProvider = ({ children }: { children: ReactNode }): ReactNode => {
  // `useId` is the only generator that agrees between the server render and
  // hydration. A counter or a random value produces different ids on each side,
  // React discards the server-rendered attributes, and the `for`/`aria-*` pairings
  // written during SSR are left pointing at ids that no longer exist.
  const scope = useId()
  return <FormDomScopeContext.Provider value={scope}>{children}</FormDomScopeContext.Provider>
}

/**
 * The active scope, or `''` when rendered outside a form. Field widgets are also
 * composed directly by the admin user and role screens, which have no
 * `FormProvider`, so an absent scope degrades to the unprefixed id rather than
 * throwing.
 */
export function useFormDomScope(): string {
  return useContext(FormDomScopeContext) ?? ''
}

/**
 * Scope a derived DOM id.
 *
 * A caller-supplied `id` is returned untouched: it is the author's identifier, it
 * may already be referenced from outside the form, and scoping it would break that
 * reference as well as double-prefix ids that pass through here twice.
 *
 * The result is a valid HTML id and a valid `for` / `aria-*` reference, but React's
 * generated scope contains characters that need escaping in a CSS selector. Resolve
 * these with `document.getElementById`, not `querySelector('#…')`.
 */
export function useScopedDomId(base: string, explicit?: string): string {
  const scope = useFormDomScope()
  if (explicit != null) return explicit
  return scope === '' ? base : `${scope}${base}`
}
