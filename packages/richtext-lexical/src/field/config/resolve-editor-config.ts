/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { EditorConfig } from './types'

/**
 * Merge a schema field's `editorConfig` over the registered editor's
 * config (baked at registration via `lexicalEditor()`, or the package
 * default).
 *
 * This is a MERGE, not a pick-one precedence — each layer can only express
 * what its side is allowed to carry, so whole-object precedence would
 * silently discard the rest:
 *
 *   - The field layer (schema side) is JSON-safe: `settings` + `lexical`
 *     only, never `extensions`. It is the most specific layer, so its
 *     values win — but ONLY for the keys it can express. Settings merge
 *     per-key (including `settings.options`), so a field config produced
 *     by a partial override keeps the registered layer's remaining flags.
 *   - The registered layer is the only one that can carry an `extensions`
 *     graph. Before this merge existed, a schema-side `editorConfig`
 *     replaced the baked config wholesale, throwing away registration-time
 *     extension changes (an added AI extension, removed Insert-menu
 *     extensions, …) and silently falling back to the built-in list.
 *
 * Returns the registered config as-is when the field carries no
 * `editorConfig`. Never mutates either input.
 */
export function resolveEditorConfig(
  fieldConfig: EditorConfig | undefined,
  registeredConfig: EditorConfig
): EditorConfig {
  if (fieldConfig == null) return registeredConfig
  return {
    settings: {
      ...registeredConfig.settings,
      ...fieldConfig.settings,
      options: {
        ...registeredConfig.settings.options,
        ...fieldConfig.settings?.options,
      },
    },
    lexical: fieldConfig.lexical ?? registeredConfig.lexical,
    // Schema-side configs never carry extensions (not JSON-safe); the
    // registered editor's graph survives a field-level settings override.
    extensions: fieldConfig.extensions ?? registeredConfig.extensions,
  }
}
