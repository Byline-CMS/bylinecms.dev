/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type BlockData, type BlockFieldData, defineBlock } from '@byline/core'

/**
 * Reference block for the dedicated `code` field. The `language` select is
 * bound to the editor through `languageField`, so changing the select
 * re-highlights the CodeMirror widget live — the language is also a real,
 * queryable field the frontend renderer receives.
 */
export const CodeBlock = defineBlock({
  blockType: 'codeBlock',
  label: 'Code Block',
  helpText: 'A block for displaying a snippet of source code with syntax highlighting.',
  fields: [
    {
      name: 'language',
      label: 'Language',
      type: 'select',
      defaultValue: 'typescript',
      options: [
        { label: 'TypeScript', value: 'typescript' },
        { label: 'JavaScript', value: 'javascript' },
        { label: 'HTML', value: 'html' },
        { label: 'CSS', value: 'css' },
        { label: 'JSON', value: 'json' },
        { label: 'Markdown', value: 'markdown' },
        { label: 'Python', value: 'python' },
        { label: 'SQL', value: 'sql' },
        { label: 'YAML', value: 'yaml' },
        { label: 'Plain text', value: 'plain' },
      ],
    },
    {
      name: 'code',
      label: 'Code',
      type: 'code',
      languageField: 'language',
    },
    {
      name: 'caption',
      label: 'Caption',
      type: 'text',
      optional: true,
      localized: true,
    },
  ],
})

/**
 * Schema-local field-only data shape for forms or block helpers. Application
 * consumers should use the canonical generated block type.
 */
export type CodeBlockFields = BlockFieldData<typeof CodeBlock>

/**
 * Schema-local full block instance shape (`_id`, `_type` + fields). Application
 * renderers should use the generated `CodeBlockData`.
 */
export type CodeBlockData = BlockData<typeof CodeBlock>
