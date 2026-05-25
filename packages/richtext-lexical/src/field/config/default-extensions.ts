/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Client-only — pulls in every built-in extension along with their React
 * decorators and modal components. The `/server` entry never imports
 * this file.
 */

import { ClearEditorExtension, TabIndentationExtension } from '@lexical/extension'
import { CheckListExtension, ListExtension } from '@lexical/list'
import type { AnyLexicalExtensionArgument } from 'lexical'

import { AdmonitionExtension } from '../extensions/admonition/admonition-extension'
import { AutoEmbedExtension } from '../extensions/auto-embed/auto-embed-extension'
import { BylineFloatingUIExtension } from '../extensions/byline-floating-ui/byline-floating-ui-extension'
import { BylineToolbarExtension } from '../extensions/byline-toolbar/byline-toolbar-extension'
import { CodeHighlightExtension } from '../extensions/code-highlight/code-highlight-extension'
import { FloatingTextFormatExtension } from '../extensions/floating-text-format/floating-text-format-extension'
import { HorizontalRuleExtension } from '../extensions/horizontal-rule/horizontal-rule-extension'
import { InlineImageExtension } from '../extensions/inline-image/inline-image-extension'
import { LayoutExtension } from '../extensions/layout/layout-extension'
import { LinkExtension } from '../extensions/link/link-extension'
import { TableExtension } from '../extensions/table/table-extension'
import { VimeoExtension } from '../extensions/vimeo/vimeo-extension'
import { YouTubeExtension } from '../extensions/youtube/youtube-extension'
import { defaultEditorConfig } from './default'
import { ExtensionsList } from './extensions-list'
import type { EditorConfig } from './types'

/**
 * Returns a fresh array of every Byline-built-in Lexical extension in
 * their canonical order. Includes the `BylineToolbarExtension` registry
 * itself so contributing extensions can attach their toolbar items via
 * `peerDependencies`.
 *
 * Order matters: stock framework extensions (clear-editor, tab-indent)
 * come first; toolbar contract sits ahead of any contributing extension;
 * relation-bearing extensions (link, image) land near the end.
 *
 * Note: `AutoFocusExtension` is intentionally *not* included. Its root
 * listener fires on every root re-attach (initial mount and after
 * setEditorState swaps), pulling the caret to `rootEnd` — which surfaced
 * as "cursor jumps to the end of the field on tab switch / after save."
 * The pre-extensions default (`autoFocusPlugin: false`) was also off.
 * Callers who want auto-focus can opt in via `lexicalEditor((c) => ...)`.
 */
export function defaultExtensionsArray(): AnyLexicalExtensionArgument[] {
  return [
    // Always-on stock extensions.
    ClearEditorExtension,
    TabIndentationExtension,

    // Toolbar + floating-UI contracts — must be present before any
    // extension that contributes items to them via `peerDependencies`.
    BylineToolbarExtension,
    BylineFloatingUIExtension,

    // Block- / list-level features.
    ListExtension,
    CheckListExtension,
    HorizontalRuleExtension,
    LayoutExtension,
    AdmonitionExtension,
    CodeHighlightExtension,
    TableExtension,

    // Link & link-related.
    LinkExtension,

    // Embeds & inline images.
    InlineImageExtension,
    YouTubeExtension,
    VimeoExtension,
    AutoEmbedExtension,

    // Floating UIs (the text-format popover lives at the floating-UI layer
    // rather than the toolbar contract, so it gets its own extension).
    FloatingTextFormatExtension,
  ]
}

/** Fresh `ExtensionsList` populated with the built-in extensions. */
export function defaultExtensionsList(): ExtensionsList {
  return new ExtensionsList(defaultExtensionsArray())
}

/**
 * Client-side default editor config — settings + lexical config + the
 * full default extensions list. Used by `lexicalEditor((c) => ...)` as
 * the seed before invoking the configure callback. Server-only modules
 * (e.g. seeds) must import `defaultEditorConfig` from
 * `@byline/richtext-lexical/server` instead.
 */
export const defaultClientEditorConfig: EditorConfig = {
  ...defaultEditorConfig,
  extensions: defaultExtensionsList(),
}
