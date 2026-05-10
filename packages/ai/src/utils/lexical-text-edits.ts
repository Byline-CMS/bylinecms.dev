/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { z } from 'zod'

export const lexicalTextEditsResponseSchema = z.object({
  edits: z.array(
    z.object({
      id: z.number(),
      text: z.string(),
    })
  ),
})

export type LexicalTextEditsResponse = z.infer<typeof lexicalTextEditsResponseSchema>

export type ExtractedTextNode = {
  id: number
  path: (string | number)[]
  text: string
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false
}

export function extractTextNodesFromLexicalState(state: unknown): ExtractedTextNode[] {
  const nodes: ExtractedTextNode[] = []

  const walk = (value: unknown, path: (string | number)[]) => {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        walk(value[index], [...path, index])
      }
      return
    }

    if (!isPlainObject(value)) return

    const type = value.type
    const text = value.text
    if (type === 'text' && typeof text === 'string') {
      nodes.push({
        id: nodes.length,
        path: [...path, 'text'],
        text,
      })
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'text') continue
      walk(child, [...path, key])
    }
  }

  walk(state, [])
  return nodes
}

export function setAtPath(root: unknown, path: (string | number)[], value: unknown): void {
  let cursor: any = root
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (cursor == null) {
      throw new Error('Invalid path: hit null/undefined')
    }
    cursor = cursor[key as any]
  }

  const last = path[path.length - 1]
  if (cursor == null) {
    throw new Error('Invalid path: hit null/undefined at leaf parent')
  }
  cursor[last as any] = value
}
