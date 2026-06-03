/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The `name` of every built-in extension, as a plain string map.
 *
 * This module is **React-free and runtime-free** — it carries only the
 * identifying strings, never the extension classes (which statically
 * import their React plugins / nodes). That lets config-only code paths
 * (the `@byline/richtext-lexical/config` subpath) reference a built-in
 * for `extensions.remove(...)` / `.has(...)` / `.replace(...)` without
 * dragging the editor runtime into the importing bundle.
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
 * Each value MUST stay in sync with the corresponding extension's
 * `defineExtension({ name })` — they share the `@byline/richtext-lexical/*`
 * convention (suffix === map key). `built-in-extension-names.test.node.ts`
 * guards this module's own integrity (convention, uniqueness); the mirror
 * against the live extension `name`s is exercised by the editor's
 * jsdom/integration coverage.
 */
export const builtInExtensions = {
  Admonition: '@byline/richtext-lexical/Admonition',
  AutoEmbed: '@byline/richtext-lexical/AutoEmbed',
  AutoLink: '@byline/richtext-lexical/AutoLink',
  CodeHighlight: '@byline/richtext-lexical/CodeHighlight',
  FloatingTextFormat: '@byline/richtext-lexical/FloatingTextFormat',
  FloatingUI: '@byline/richtext-lexical/FloatingUI',
  HorizontalRule: '@byline/richtext-lexical/HorizontalRule',
  InlineImage: '@byline/richtext-lexical/InlineImage',
  Layout: '@byline/richtext-lexical/Layout',
  Link: '@byline/richtext-lexical/Link',
  Table: '@byline/richtext-lexical/Table',
  Toolbar: '@byline/richtext-lexical/Toolbar',
  Vimeo: '@byline/richtext-lexical/Vimeo',
  YouTube: '@byline/richtext-lexical/YouTube',
} as const

/** Union of the built-in extension `name` strings. */
export type BuiltInExtensionName = (typeof builtInExtensions)[keyof typeof builtInExtensions]
