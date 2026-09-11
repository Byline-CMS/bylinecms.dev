/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Development-only preview of the two content-adaptation surfaces.
 *
 * Both editors below run on fixed in-memory values, so this page reads
 * and writes nothing: no collection, no document, no stored content is
 * involved, and nothing here can alter a saved value.
 *
 * It exists because the adapted and read-only states depend on a field's
 * configuration having narrowed since a document was written, which is
 * awkward to stage against real content just to look at it.
 *
 * Visit `/admin/richtext-notices` with the dev server running.
 *
 * It lives under the admin prefix deliberately. `locale-rewrite.ts`
 * prefixes a locale onto any path outside
 * `NON_LOCALIZED_ROUTE_PATHS` (admin, api, sign-in), so a top-level
 * route here would be rewritten to `/<locale>/…`, fall through to the
 * frontend splat, and 404.
 */

import { useState } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'

import { builtInExtensions, defaultClientEditorConfig, EditorField } from '@byline/richtext-lexical'
import { Button } from '@byline/ui/react'

import './richtext-notices.css'

/**
 * Structural stand-in for Lexical's `EditorValue`. The webapp
 * deliberately does not depend on `lexical` — the editor package owns
 * that — so this preview describes the shape it passes rather than
 * importing the type.
 */
type EditorValue = { root: Record<string, unknown> }

export const Route = createFileRoute('/_byline/admin/richtext-notices')({
  // Development only, enforced rather than merely described. Vite
  // statically replaces `import.meta.env.DEV`, so the guard also lets the
  // page drop out of a production build.
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw notFound()
    }
  },
  component: RichTextNoticesPreview,
})

const text = (value: string) => ({
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text: value,
  type: 'text',
  version: 1,
})

/** A heading — adaptable, so the field opens editable with a notice. */
const HEADING_VALUE = {
  root: {
    children: [
      {
        children: [text('A heading this field no longer supports')],
        direction: null,
        format: '',
        indent: 0,
        type: 'heading',
        version: 1,
        tag: 'h1',
      },
      {
        children: [text('An ordinary paragraph that is left completely alone.')],
        direction: null,
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
} as EditorValue

/** An inline image — no safe conversion, so the field declines to edit. */
const IMAGE_VALUE = {
  root: {
    children: [
      {
        children: [
          {
            type: 'inline-image',
            version: 1,
            targetDocumentId: 'preview-doc',
            targetCollectionPath: 'media',
            src: '/preview.png',
            position: 'full',
            altText: 'a preview image',
            width: 120,
            height: 90,
            showCaption: false,
            caption: {
              editorState: {
                root: {
                  children: [],
                  direction: null,
                  format: '',
                  indent: 0,
                  type: 'root',
                  version: 1,
                },
              },
            },
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
} as EditorValue

/**
 * An empty document.
 *
 * Clearing has to pass this rather than `undefined`: ApplyValuePlugin
 * early-returns on a null value (`if (value == null) return`), so passing
 * undefined leaves the previous content and notice in place instead of
 * clearing them.
 */
const EMPTY_VALUE = {
  root: {
    children: [
      {
        children: [],
        direction: null,
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
} as EditorValue

function PreviewEditor({
  title,
  description,
  removals,
  value,
}: {
  title: string
  description: string
  removals: string[]
  value: EditorValue
}): React.JSX.Element {
  const [current, setCurrent] = useState<EditorValue>(value)
  const extensions = defaultClientEditorConfig.extensions?.clone()
  for (const name of removals) extensions?.remove(name)

  return (
    <section className="byline-notices-preview__section">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>{title}</h2>
      <p className="byline-notices-preview__note">{description}</p>
      <div className="byline-notices-preview__field">
        <EditorField
          id={title}
          name={title}
          editorConfig={{ ...defaultClientEditorConfig, extensions }}
          // biome-ignore lint/suspicious/noExplicitAny: preview fixture boundary
          value={current as any}
        />
      </div>
      <div style={{ marginTop: 8 }}>
        <Button
          type="button"
          variant="outlined"
          size="sm"
          onClick={() => {
            setCurrent(current === value ? EMPTY_VALUE : value)
          }}
        >
          {current === value ? 'Clear the value' : 'Restore the value'}
        </Button>
      </div>
    </section>
  )
}

function RichTextNoticesPreview(): React.JSX.Element {
  return (
    <main className="byline-notices-preview">
      <h1 style={{ fontSize: 20 }}>Richtext content-adaptation preview</h1>
      <p className="byline-notices-preview__note">
        Development only. Both editors use fixed in-memory values — nothing is read from or written
        to the database.
      </p>

      <PreviewEditor
        title="Adapted content"
        description="Headings removed, stored value contains one. Expect an amber notice above an editable field, the heading shown as ordinary text, and the paragraph untouched."
        removals={[builtInExtensions.Heading]}
        value={HEADING_VALUE}
      />

      <PreviewEditor
        title="Content with no safe conversion"
        description="Inline images removed, stored value contains one. Expect a red notice naming the content and no editor beneath it. Clearing the value should restore an ordinary editable field."
        removals={[builtInExtensions.InlineImage]}
        value={IMAGE_VALUE}
      />
    </main>
  )
}
