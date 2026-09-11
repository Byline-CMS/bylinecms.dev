/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type Field,
  formatDeclarationPath,
  type RichTextField,
  toDeclarationSegments,
  walkFieldDeclarations,
} from '@byline/core'

export interface RichTextTarget {
  collectionPath: string
  /** Declaration path — `content.photoBlock.caption`, no selectors. */
  fieldPath: string
  field: RichTextField
  // biome-ignore lint/suspicious/noExplicitAny: an editor component from the admin config
  Editor?: any
  /** Which registry supplied the editor — shown so a wrong one is visible. */
  resolvedFrom: string
  unresolvedReason?: string
}

/**
 * Every richtext field in every collection, with the editor component
 * that field would actually render.
 *
 * Resolution mirrors the renderers, and the two differ by position:
 *
 *  - A TOP-LEVEL field takes a per-field override from the collection's
 *    admin `fields` map, keyed by its dotted path, else the globally
 *    registered editor (`FieldRenderer`).
 *  - A field INSIDE A BLOCK takes its override from the blockType-keyed
 *    `AdminConfig.blockAdmin` registry, keyed by the path within the
 *    block (`BlocksField`). Blocks are cross-collection units, so their
 *    admin config applies wherever the block renders, and the
 *    collection's own field map cannot address inside one.
 *
 * Measuring a block field against the collection map would report the
 * wrong editor — broader than the field really is — and a scan built on
 * that would call affected documents clean.
 *
 * A field with no editor at all is reported with `supportedTypes: null`
 * rather than skipped: the scanner must never treat an unexamined field
 * as clean.
 */
export function collectRichTextTargets(adminConfig: unknown): RichTextTarget[] {
  // biome-ignore lint/suspicious/noExplicitAny: admin config shape varies by host
  const config = adminConfig as any
  const globalEditor = config.fields?.richText?.editor

  // biome-ignore lint/suspicious/noExplicitAny: block admin entries vary by host
  const blockAdminByType = new Map<string, any>()
  for (const entry of config.blockAdmin ?? []) {
    blockAdminByType.set(entry.blockType, entry)
  }

  const targets: RichTextTarget[] = []

  for (const collection of config.collections ?? []) {
    const adminForCollection = (config.admin ?? []).find(
      // biome-ignore lint/suspicious/noExplicitAny: admin resource shape varies
      (entry: any) => entry.path === collection.path
    )

    walkFieldDeclarations(collection.fields as Field[], (field, segments) => {
      if (field.type !== 'richText') return
      const fieldPath = formatDeclarationPath(toDeclarationSegments(segments))

      // The innermost block this field sits in, if any, and its path
      // within that block — `faq.answer` for `content.faqBlock.faq.answer`.
      let blockType: string | undefined
      let withinBlock: string[] = []
      for (const segment of segments) {
        if (segment.kind === 'blockType') {
          blockType = segment.blockType
          withinBlock = []
        } else if (segment.kind === 'field') {
          withinBlock.push(segment.name)
        }
      }

      const override =
        blockType != null
          ? blockAdminByType.get(blockType)?.fields?.[withinBlock.join('.')]?.editor
          : adminForCollection?.fields?.[fieldPath]?.editor

      const Editor = override ?? globalEditor
      targets.push({
        collectionPath: collection.path,
        fieldPath,
        field: field as RichTextField,
        Editor,
        resolvedFrom:
          override != null
            ? blockType != null
              ? `blockAdmin:${blockType}`
              : 'collection'
            : 'global',
        unresolvedReason:
          Editor == null ? 'No richText editor registered for this field.' : undefined,
      })
    })
  }
  return targets
}
