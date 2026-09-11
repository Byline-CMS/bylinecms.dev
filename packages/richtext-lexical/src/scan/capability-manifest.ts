'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { buildEditorFromExtensions } from '@lexical/extension'
import { ReactPluginHostExtension } from '@lexical/react/ReactPluginHostExtension'
import { defineExtension } from 'lexical'

import { registeredNodeTypes } from '../field/capabilities/registered-node-types'
import { defaultExtensionsList } from '../field/config/default-extensions'
import { rootDependencies } from '../field/config/root-dependencies'
import type { EditorConfig } from '../field/config/types'
import type { CapabilityManifest, FieldCapabilities } from './types'

/**
 * What one field accepts, measured by BUILDING its editor.
 *
 * Deliberately not derived by walking declared `nodes` on the extension
 * list: that would recreate the resolver — dependency-contributed nodes,
 * conflicts, replacements and always-on core nodes — and a manifest that
 * disagrees with the runtime is worse than no manifest. This is the same
 * construction `EditorContext` performs, so the two cannot drift.
 *
 * Requires a DOM and a React-capable module graph, because several
 * extensions host React decorators. It therefore runs in a browser or
 * jsdom, never in a plain Node script — which is why the manifest is a
 * file handed to the scanner rather than something the scanner derives.
 */
export function capabilitiesFor(
  collectionPath: string,
  fieldPath: string,
  config: Pick<EditorConfig, 'extensions' | 'lexical'>
): FieldCapabilities {
  const extensions = config.extensions ?? defaultExtensionsList()
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: '[capability-manifest]',
      namespace: config.lexical?.namespace ?? 'LexicalRichText',
      // Through the same seam the live editor uses — a manifest that
      // disagreed about the always-on core nodes would misreport every
      // document containing one.
      // biome-ignore lint/suspicious/noExplicitAny: extension arguments are heterogeneous
      dependencies: [ReactPluginHostExtension, ...rootDependencies(extensions)] as any,
    })
  )
  const supportedTypes = [...registeredNodeTypes(editor)].sort()
  editor.dispose()
  return { collectionPath, fieldPath, supportedTypes }
}

/** Assemble a manifest from per-field capabilities. */
export function buildManifest(fields: FieldCapabilities[]): CapabilityManifest {
  return { generatedAt: new Date().toISOString(), fields }
}

/**
 * What a live editor accepts.
 *
 * `capabilitiesFor` needs a resolved `EditorConfig`, which is not always
 * reachable: `lexicalEditor()` closes over its configure callback inside
 * a lazy component, so a site's own preset exposes no config to inspect.
 * Measuring a mounted editor works for any field however its editor was
 * registered, which is what a manifest walk over real collections needs.
 */
export function capabilitiesFromEditor(
  collectionPath: string,
  fieldPath: string,
  editor: Parameters<typeof registeredNodeTypes>[0]
): FieldCapabilities {
  return {
    collectionPath,
    fieldPath,
    supportedTypes: [...registeredNodeTypes(editor)].sort(),
  }
}
