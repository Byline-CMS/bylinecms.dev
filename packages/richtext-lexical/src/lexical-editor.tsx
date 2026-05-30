/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { lazy, Suspense } from 'react'

import type { RichTextEditorComponent } from '@byline/core'
import { Shimmer } from '@byline/ui/react'

import type { ExtensionsList } from './field/config/extensions-list'
import type { EditorConfig } from './field/config/types'

/**
 * Inside `lexicalEditor((c) => ...)` the seed always carries an
 * `ExtensionsList`, so narrow the callback parameter so callers can write
 * `c.extensions.add(...)` without a non-null assertion.
 */
export type LexicalEditorConfigureInput = Omit<EditorConfig, 'extensions'> & {
  extensions: ExtensionsList
}

type ConfigureFn = (config: LexicalEditorConfigureInput) => LexicalEditorConfigureInput

/**
 * Bundle of editor internals that are dynamically imported on first
 * mount. Kept narrow so the chunk only carries what the configure step
 * + render need — extension classes the user references directly stay
 * out of this bundle and remain tree-shakeable.
 */
interface EditorBundle {
  RichTextField: typeof import('./richtext-field').RichTextField
  defaultEditorConfig: typeof import('./field/config/default').defaultEditorConfig
  defaultExtensionsList: typeof import('./field/config/default-extensions').defaultExtensionsList
  cloneDeep: <T>(value: T) => T
}

let editorBundlePromise: Promise<EditorBundle> | null = null

function loadEditorBundle(): Promise<EditorBundle> {
  // Memoize the import so multiple `lexicalEditor()` calls share one chunk
  // load — React.lazy already caches per-wrapper, but consumers that call
  // the factory more than once would otherwise create parallel promises.
  if (!editorBundlePromise) {
    editorBundlePromise = (async () => {
      const [richtextMod, defaultMod, extensionsMod, lodashMod] = await Promise.all([
        import('./richtext-field'),
        import('./field/config/default'),
        import('./field/config/default-extensions'),
        import('lodash-es'),
      ])
      return {
        RichTextField: richtextMod.RichTextField,
        defaultEditorConfig: defaultMod.defaultEditorConfig,
        defaultExtensionsList: extensionsMod.defaultExtensionsList,
        cloneDeep: lodashMod.cloneDeep,
      }
    })()
  }
  return editorBundlePromise
}

/**
 * Returns a `RichTextEditorComponent` with editor settings baked in. Use
 * this at the registration site in your admin config when you want to
 * customise the editor across the whole installation; per-field
 * overrides via `RichTextField.editorConfig` continue to take precedence
 * at render time.
 *
 * The returned component is lazy: the editor module graph (RichTextField
 * + every built-in extension + the Lexical core) is dynamically imported
 * on first mount, so callers that merely *reference* `lexicalEditor` at
 * registration time don't drag the editor onto every bundle that touches
 * the registration. The `configure` callback runs once the chunk has
 * loaded, with the same seed it received before.
 *
 * The `configure` callback receives a deep clone of `defaultEditorConfig`
 * with `extensions` populated from `defaultExtensionsList()`. Mutate the
 * clone freely — it's local to this call. Use the chainable
 * `c.extensions.add(...)`, `.remove(...)`, `.replace(...)`, and
 * `.configure(...)` methods to manipulate the extension graph.
 *
 * Calling `lexicalEditor()` with no argument is equivalent to
 * registering `RichTextField` directly with the package defaults.
 *
 * @example
 * ```ts
 * import { lexicalEditor, TableExtension } from '@byline/richtext-lexical'
 *
 * defineClientConfig({
 *   fields: {
 *     richText: {
 *       editor: lexicalEditor((c) => {
 *         c.extensions.remove(TableExtension)        // drop a built-in
 *         c.settings.placeholderText = 'Start writing...'
 *         return c
 *       }),
 *     },
 *   },
 * })
 * ```
 */
export function lexicalEditor(configure?: ConfigureFn): RichTextEditorComponent {
  const Lazy = lazy(async () => {
    const { RichTextField, defaultEditorConfig, defaultExtensionsList, cloneDeep } =
      await loadEditorBundle()

    let baked: EditorConfig | undefined
    if (configure) {
      const seed: LexicalEditorConfigureInput = {
        ...cloneDeep(defaultEditorConfig),
        extensions: defaultExtensionsList(),
      }
      baked = configure(seed)
    }

    const Configured: RichTextEditorComponent = (props) => (
      <RichTextField {...props} editorConfig={baked} />
    )
    return { default: Configured as React.ComponentType<any> }
  })

  const ConfiguredEditor: RichTextEditorComponent = (props) => (
    <Suspense fallback={<EditorPlaceholder />}>
      <Lazy {...(props as object)} />
    </Suspense>
  )
  return ConfiguredEditor
}

/**
 * Skeleton shown while the editor module graph is loading. Mirrors the
 * `byline-field-richtext` / `byline-field-richtext-body` shell that
 * `RichTextField` renders, and reuses the same `Shimmer` placeholder the
 * inner `EditorField` Suspense uses — so the visible cold-load sequence
 * is just "shimmer → editor" instead of "blank → shimmer → editor".
 */
function EditorPlaceholder() {
  return (
    <div className="byline-field-richtext">
      <div className="byline-field-richtext-body">
        <Shimmer variant="text" lines={20} lineHeight="1.15rem" />
      </div>
    </div>
  )
}
