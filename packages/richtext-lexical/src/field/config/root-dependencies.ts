/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AnyLexicalExtensionArgument } from 'lexical'

import { CoreNodesExtension } from '../extensions/core-nodes/core-nodes-extension'
import type { ExtensionsList } from './extensions-list'

/**
 * The complete dependency list for an editor root.
 *
 * `editorConfig.extensions` carries the OPTIONAL features a site
 * configures. What an editor actually registers is that list plus
 * mandatory infrastructure, and `CoreNodesExtension` is injected here
 * rather than living in the configurable list because `MarkNode` and
 * `OverflowNode` belong to no switchable feature — `ExtensionsList.remove()`
 * matches by name and accepts the extension object, so an entry in the
 * list could be removed by site code.
 *
 * Everything that builds an editor goes through this: the live editor,
 * the test builders, and the capability manifest. A manifest that
 * disagreed with the runtime about which nodes exist would be worse than
 * no manifest, and this is the seam that keeps them identical.
 */
export function rootDependencies(extensions: ExtensionsList): AnyLexicalExtensionArgument[] {
  return [CoreNodesExtension, ...extensions.toArray()]
}
