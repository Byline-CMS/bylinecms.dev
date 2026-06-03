/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Lexical commands for the AI drawer, split out of `plugin.tsx` so the
 * extension definition (and any toolbar contribution) can reference them
 * without statically importing the drawer's React component graph. This
 * keeps `AiLexicalExtension` light enough to be referenced from an
 * eagerly-evaluated admin/client config.
 */

import { createCommand } from 'lexical'

export const TOGGLE_AI_DRAWER_COMMAND = createCommand('TOGGLE_AI_DRAWER_COMMAND')

/**
 * Broadcasts the AI drawer's open/closed state so contributed UI (the
 * toolbar button) can show an active visual cue. Dispatched by the drawer
 * plugin whenever `open` changes — including closes triggered from the
 * drawer's own controls. Observers register a listener and return `false`.
 */
export const AI_DRAWER_STATE_COMMAND = createCommand<boolean>('AI_DRAWER_STATE_COMMAND')
