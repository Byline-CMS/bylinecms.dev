/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Leaf module for the admonition Lexical commands. Lives apart from
 * `admonition-extension.tsx` so the node class (`admonition-node.tsx`)
 * can dispatch the "open modal" command from its `createDOM` chrome
 * without importing the extension (which imports the node — a cycle).
 */

import { createCommand, type LexicalCommand, type NodeKey } from 'lexical'

import type { AdmonitionAttributes } from './node-types'

/**
 * Opens the admonition modal. Payload of `null` means "insert a new
 * admonition"; a `{ nodeKey }` payload means "edit the existing node"
 * — dispatched by the per-node Edit button rendered in `createDOM`.
 */
export const OPEN_ADMONITION_MODAL_COMMAND: LexicalCommand<{ nodeKey: NodeKey } | null> =
  createCommand('OPEN_ADMONITION_MODAL_COMMAND')

/** Inserts a new admonition (type + title come from the modal). */
export const INSERT_ADMONITION_COMMAND: LexicalCommand<AdmonitionAttributes> = createCommand(
  'INSERT_ADMONITION_COMMAND'
)
