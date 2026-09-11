/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { MarkNode } from '@lexical/mark'
import { OverflowNode } from '@lexical/overflow'
import { defineExtension } from 'lexical'

/**
 * Owns the node classes that belong to no switchable feature.
 *
 * `MarkNode` and `OverflowNode` ship without an upstream extension, and
 * neither corresponds to something a field can turn off. Without an
 * owner both would lose their only registration once the editor root
 * stopped registering a blanket node list.
 *
 * `EditorContext` injects this extension directly into the root's
 * dependencies, outside `editorConfig.extensions`. Leaving it out of
 * `builtInExtensions` would NOT have made it non-removable: this module
 * is publicly exported and `ExtensionsList.remove()` accepts an
 * extension object as readily as a name string, so site code could have
 * removed it from the configurable list. Injection at the root is what
 * enforces its presence.
 */
export const CoreNodesExtension = defineExtension({
  name: '@byline/richtext-lexical/CoreNodes',
  nodes: () => [MarkNode, OverflowNode],
})
