/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  patchDoc as patchAnthropicDoc,
  patchDocStreaming as patchAnthropicDocStreaming,
} from './models/anthropic/patch'
import {
  patchDoc as patchGeminiDoc,
  patchDocStreaming as patchGeminiDocStreaming,
} from './models/google/patch'
import {
  patchDoc as patchOpenAIDoc,
  patchDocStreaming as patchOpenAIDocStreaming,
} from './models/openai/patch'
import { extractTextNodesFromLexicalState, setAtPath } from './utils/lexical-text-edits'
import type { Provider } from './@types'

export interface PatchOptions {
  provider: Provider
  apiKey: string
  modelName: string
  prompt: string
  editorState: any
  signal?: AbortSignal
}

export interface PatchResult {
  success: true
  editor: any
  message: string
}

export interface PatchError {
  success: false
  message: string
  errors: Record<string, string[]>
}

export type PatchStreamingResult = {
  text: AsyncIterable<string>
  final: Promise<PatchResult | PatchError>
}

const createEmptyTextStream = (): AsyncIterable<string> =>
  (async function* () {
    // intentionally empty
  })()

const pickPatchDoc = (provider: Provider) =>
  provider === 'openai'
    ? patchOpenAIDoc
    : provider === 'google'
      ? patchGeminiDoc
      : patchAnthropicDoc

const pickPatchDocStreaming = (provider: Provider) =>
  provider === 'openai'
    ? patchOpenAIDocStreaming
    : provider === 'google'
      ? patchGeminiDocStreaming
      : patchAnthropicDocStreaming

async function processPatchResult(
  result: { edits: Array<{ id: number; text: string }> },
  extracted: Array<{ id: number; text: string; path: any[] }>,
  editorState: any
): Promise<PatchResult | PatchError> {
  const edits = result.edits

  if (edits.length !== extracted.length) {
    return {
      success: false,
      message: 'AI returned an unexpected number of edits.',
      errors: {},
    }
  }

  const expectedIds = new Set(extracted.map((n) => n.id))
  for (const edit of edits) {
    if (!expectedIds.has(edit.id)) {
      return {
        success: false,
        message: 'AI returned edits with unexpected ids.',
        errors: {},
      }
    }
  }

  // Apply edits to the editor state (mutates editorState)
  for (const edit of edits) {
    const node = extracted[edit.id]
    if (!node) continue
    try {
      setAtPath(editorState, node.path, edit.text)
    } catch {
      // Ignore invalid paths; schema validation can be added later.
    }
  }

  return {
    success: true,
    editor: editorState,
    message: 'Task completed successfully via AI instruction (patch mode).',
  }
}

/**
 * Patches an existing Lexical document by extracting text nodes,
 * sending them to an AI model for editing, and applying the edits
 * back to the original document structure.
 *
 * This preserves all formatting (headings, lists, bold, italic, etc.)
 * while only modifying the text content.
 */
export async function patch(options: PatchOptions): Promise<PatchResult | PatchError> {
  const { provider, apiKey, modelName, prompt, editorState, signal } = options

  const extracted = extractTextNodesFromLexicalState(editorState)
  const inputTextNodes = extracted.map(({ id, text }) => ({ id, text }))

  if (inputTextNodes.length === 0) {
    return {
      success: false,
      message: 'No text nodes found to edit.',
      errors: { editor: ['No text nodes found to edit.'] },
    }
  }

  // Simple guardrail for prototype: avoid accidental huge prompts.
  if (inputTextNodes.length > 400) {
    return {
      success: false,
      message: 'Document too large for the current prototype (too many text nodes).',
      errors: { editor: ['Document too large for the current prototype.'] },
    }
  }

  const patch = pickPatchDoc(provider)

  const result = await patch({
    apiKey,
    model: modelName,
    prompt,
    textNodes: inputTextNodes,
    signal,
  })

  return processPatchResult(result, extracted, editorState)
}

/**
 * Streams a Lexical document patch.
 */
export function patchStreaming(options: PatchOptions): PatchStreamingResult {
  const { provider, apiKey, modelName, prompt, editorState, signal } = options

  const extracted = extractTextNodesFromLexicalState(editorState)
  const inputTextNodes = extracted.map(({ id, text }) => ({ id, text }))

  if (inputTextNodes.length === 0) {
    return {
      text: createEmptyTextStream(),
      final: Promise.resolve({
        success: false,
        message: 'No text nodes found to edit.',
        errors: { editor: ['No text nodes found to edit.'] },
      }),
    }
  }

  if (inputTextNodes.length > 400) {
    return {
      text: createEmptyTextStream(),
      final: Promise.resolve({
        success: false,
        message: 'Document too large for the current prototype (too many text nodes).',
        errors: { editor: ['Document too large for the current prototype.'] },
      }),
    }
  }

  const patchStreaming = pickPatchDocStreaming(provider)

  const streamResult = patchStreaming({
    apiKey,
    model: modelName,
    prompt,
    textNodes: inputTextNodes,
    signal,
  })

  const final = (async (): Promise<PatchResult | PatchError> => {
    const result = await streamResult.final
    return processPatchResult(result, extracted, editorState)
  })()

  return { text: streamResult.text, final }
}
