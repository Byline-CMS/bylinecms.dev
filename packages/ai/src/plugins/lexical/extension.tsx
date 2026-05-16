'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type BylineToolbarConfig,
  BylineToolbarExtension,
  useToolbarActiveEditor,
} from '@byline/richtext-lexical'
import { AiIcon } from '@byline/ui/react'
import { ReactExtension } from '@lexical/react/ReactExtension'
import { configExtension, declarePeerDependency, defineExtension } from 'lexical'

import { AiPluginLexical, TOGGLE_AI_DRAWER_COMMAND } from './plugin'

function AiToolbarButton(): React.JSX.Element {
  const editor = useToolbarActiveEditor()
  return (
    <button
      type="button"
      className="toolbar-item spaced"
      aria-label="Toggle AI assistant"
      onClick={() => {
        editor.dispatchCommand(TOGGLE_AI_DRAWER_COMMAND, undefined)
      }}
    >
      <AiIcon />
    </button>
  )
}

/**
 * Lexical extension for Byline's AI assistant. Add to the editor via
 * `lexicalEditor((c) => c.extensions.add(AiLexicalExtension))` in admin
 * config, or per-field via `aiRichTextAdmin()`. Mounts the AI drawer as
 * a React decorator and contributes a toolbar button when
 * `BylineToolbarExtension` is registered.
 *
 * Server-side authentication for the underlying AI endpoint is enforced
 * by `executeAiInstruction` and provided via `<BylineAiAdminProvider>`
 * in the admin layout.
 */
export const AiLexicalExtension = defineExtension({
  name: '@byline/ai/Lexical',
  dependencies: [configExtension(ReactExtension, { decorators: [<AiPluginLexical key="d" />] })],
  peerDependencies: [
    declarePeerDependency<typeof BylineToolbarExtension>(BylineToolbarExtension.name, {
      items: [
        {
          id: '@byline/ai/Lexical/toolbar-button',
          placement: 'toolbar',
          // Push to the end of the toolbar (alongside other "auxiliary"
          // buttons that ship with higher orders).
          order: 100_001,
          node: <AiToolbarButton />,
        },
      ],
    } satisfies Partial<BylineToolbarConfig>),
  ],
})
