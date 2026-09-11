/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { LexicalEditor } from 'lexical'

/**
 * The set of node type strings this editor accepts.
 *
 * This is the ONLY place in Byline that reads `editor._nodes`. Lexical
 * declares the property on the public `LexicalEditor` type but exposes
 * no way to enumerate registered type strings — `hasNode` answers only
 * for a class you already hold, while the normalizer works from
 * serialized JSON where all it has is the type string. Keeping the
 * access here gives a future Lexical change one site to fix.
 */
export function registeredNodeTypes(editor: LexicalEditor): ReadonlySet<string> {
  return new Set(editor._nodes.keys())
}

/**
 * Whether this editor accepts `type`.
 *
 * Node registration is what decides whether a structure can exist in the
 * field at all — it governs the legacy paste path, `parseEditorState`
 * and every command that creates a node — so this is the honest answer
 * to "does this field support X", not whether some extension appears in
 * a configuration list.
 */
export function supportsNodeType(editor: LexicalEditor, type: string): boolean {
  return editor._nodes.has(type)
}
