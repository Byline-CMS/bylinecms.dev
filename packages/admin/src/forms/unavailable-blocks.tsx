/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ReactNode } from 'react'
import { createContext, useContext, useMemo } from 'react'

import { parseInstancePath, type UnavailableBlock } from '@byline/core'

import { repeatingItemPath } from './repeating-items'

const UnavailableBlocksContext = createContext<readonly UnavailableBlock[]>([])

/** Bind numeric read paths to initial item identities, so cards follow moved parents. */
function bindUnavailableBlocks(
  issues: readonly UnavailableBlock[],
  fields: Record<string, any>
): UnavailableBlock[] {
  return issues.map((issue) => {
    const parsed = parseInstancePath(issue.fieldPath)
    if (!parsed.ok) return issue
    let value: any = fields
    let path = ''
    for (const segment of parsed.segments) {
      if (segment.kind === 'field') {
        path = path ? `${path}.${segment.name}` : segment.name
        value = value?.[segment.name]
      } else if (segment.kind === 'index') {
        value = value?.[segment.index]
        path = repeatingItemPath(path, value, segment.index)
      }
    }
    return { ...issue, fieldPath: path }
  })
}

export function UnavailableBlocksProvider({
  issues,
  fields,
  children,
}: {
  issues?: readonly UnavailableBlock[]
  fields: Record<string, any>
  children: ReactNode
}) {
  const bound = useMemo(() => bindUnavailableBlocks(issues ?? [], fields), [issues, fields])
  return (
    <UnavailableBlocksContext.Provider value={bound}>{children}</UnavailableBlocksContext.Provider>
  )
}

export function useUnavailableBlocks(path: string) {
  return useContext(UnavailableBlocksContext).filter((issue) => issue.fieldPath === path)
}
