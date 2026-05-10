import { extractTextNodesFromLexicalState, setAtPath } from './lexical-text-edits'
import {
  getPatchDoc as getPatchAnthropicDoc,
  getPatchDocStreaming as getPatchAnthropicDocStreaming,
} from './models/anthropic/patch'
import {
  getPatchDoc as getPatchGeminiDoc,
  getPatchDocStreaming as getPatchGeminiDocStreaming,
} from './models/google/patch'
import {
  getPatchDoc as getPatchOpenAIDoc,
  getPatchDocStreaming as getPatchOpenAIDocStreaming,
} from './models/openai/patch'
import type { Provider, Sdk } from './@types'

export interface PatchOptions {
  provider: Provider
  apiKey: string
  modelName: string
  prompt: string
  sdk: Sdk
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
  const { provider, apiKey, modelName, prompt, sdk, editorState, signal } = options

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

  const patch =
    provider === 'openai'
      ? getPatchOpenAIDoc(sdk)
      : provider === 'google'
        ? getPatchGeminiDoc(sdk)
        : getPatchAnthropicDoc(sdk)

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
 * Streams a Lexical document patch. Only OpenAI supports streaming for now.
 */
export function patchStreaming(options: PatchOptions): PatchStreamingResult {
  const { provider, apiKey, modelName, prompt, sdk, editorState, signal } = options

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

  const patchStreaming =
    provider === 'openai'
      ? getPatchOpenAIDocStreaming(sdk)
      : provider === 'google'
        ? getPatchGeminiDocStreaming(sdk)
        : getPatchAnthropicDocStreaming(sdk)

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
