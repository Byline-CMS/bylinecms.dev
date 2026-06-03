/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Config-only surface for `@byline/richtext-lexical`.
 *
 * This entry is intentionally **light**: it carries the `lexicalEditor`
 * registration factory (which dynamic-imports the editor runtime on first
 * mount), the config types, the built-in extension **names**, and the
 * light toolbar-authoring primitives — but NOT `RichTextField` /
 * `EditorField` / `Nodes` or the heavy *content* extension classes
 * (Table, InlineImage, Admonition, …), all of which statically pull React
 * plugins, nodes, and the Lexical core. Import from here at registration
 * sites (e.g. an admin/client config that you want to evaluate eagerly)
 * so referencing the editor doesn't drag the editor module graph into the
 * importing bundle.
 *
 * To toggle a built-in extension without importing its heavy class, use
 * the name-based form of `extensions.remove/has/replace` with
 * `builtInExtensions.*`:
 *
 * ```ts
 * import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'
 *
 * lexicalEditor((c) => {
 *   c.extensions.remove(builtInExtensions.FloatingTextFormat)
 *   return c
 * })
 * ```
 *
 * Need an actual extension class (to `.add(...)` it, or pass it to
 * `configExtension`)? Import it from the `.` barrel instead — and accept
 * that doing so pulls that extension's runtime into the bundle.
 */

export {
  type BuiltInExtensionName,
  builtInExtensions,
} from './field/config/built-in-extension-names'
// Light extension-authoring primitives — the toolbar coordination
// extension, its selectors/types, and the active-editor hook. These carry
// no React plugin/node runtime (only `lexical` + a React context), so a
// third-party extension (e.g. `@byline/ai`'s Lexical extension) can
// declare a toolbar contribution and dispatch commands without pulling
// the editor's content runtime into its bundle.
export {
  type BylineToolbarConfig,
  BylineToolbarExtension,
  type BylineToolbarItem,
  type BylineToolbarPlacement,
  selectToolbarItems,
} from './field/extensions/byline-toolbar'
export {
  ToolbarActiveEditorProvider,
  useToolbarActiveEditor,
} from './field/plugins/toolbar-plugin/toolbar-active-editor'
export { lexicalEditor } from './lexical-editor'
export type { ExtensionsList } from './field/config/extensions-list'
export type { EditorConfig, EditorSettings, EditorSettingsOverride } from './field/config/types'
export type { LexicalEditorConfigureInput } from './lexical-editor'
