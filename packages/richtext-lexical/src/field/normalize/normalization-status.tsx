'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type * as React from 'react'
import { createContext, useContext, useMemo, useState } from 'react'

export type NormalizationStatus =
  | { kind: 'ok' }
  | { kind: 'adapted'; convertedTypes: string[] }
  | { kind: 'refused'; unsupportedTypes: string[] }

interface ContextValue {
  status: NormalizationStatus
  setStatus: (status: NormalizationStatus) => void
}

const Context = createContext<ContextValue>({
  status: { kind: 'ok' },
  setStatus: () => {},
})

/**
 * Carries how the stored value fared against this field's capabilities.
 *
 * Provided ABOVE the composer, like the other shared contexts, so the
 * surface that renders the notice sits outside the editor while the
 * plugin that discovers the status sits inside it.
 */
export function NormalizationStatusProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [status, setStatus] = useState<NormalizationStatus>({ kind: 'ok' })
  const value = useMemo(() => ({ status, setStatus }), [status])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useNormalizationStatus(): ContextValue {
  return useContext(Context)
}
