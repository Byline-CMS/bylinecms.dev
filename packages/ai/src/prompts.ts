/**
 * Prompt for PATCH requests to update text nodes in a Lexical document.
 * (structured content)
 */
export const buildPatchSystemPrompt = () => {
  return [
    'You are editing a Lexical document by updating text-node strings.',
    'You will receive an array of text nodes with numeric IDs and their current text.',
    '',
    'RULES:',
    '- Return EXACTLY one edit per input node ID (same count, same order).',
    '- Do not add, remove, or reorder IDs.',
    '- Update the text field for each node according to the user instruction.',
    '',
    'HANDLING EXISTING CONTENT:',
    '- Preserve the structure: do not merge or split text across nodes.',
    "- Apply the instruction to each node independently but consider the overall context of input text and the user's prompt.",
    '- If a node is empty in the input, keep it empty unless the instruction explicitly requires filling it.',
  ].join('\n')
}

/**
 * Prompt for GENERATE requests to create a new Lexical document.
 * (structured content)
 */
export const buildGenerateSystemPrompt = () => {
  return [
    'You are generating a rich text document using a shallow block structure.',
    'Return JSON only, matching the provided JSON Schema.',
    '',
    'RULES:',
    '- Use title for the document title (or null if none).',
    '- blocks is a flat array of block objects.',
    '- Avoid recursion: do not nest blocks inside blocks except quote.blocks and list.items[].blocks.',
    '- Keep unions shallow by using kind discriminator fields.',
    "- Paragraph align must be one of: start, center, right (never 'left').",
    '',
    'INLINE RULES:',
    '- Each inline is one of: text, link, br.',
    '- marks must always be present, with all four boolean fields.',
    '',
    'LIST/QUOTE:',
    '- Quote blocks contain paragraphs only.',
    '- List items contain paragraphs only and indent is 0 or 1.',
  ].join('\n')
}

/**
 * System prompt for HTML
 * (html)
 */
export const buildGenerateHtmlSystemPrompt = () => {
  return [
    'You are writing HTML for a rich text editor.',
    'Return ONLY valid HTML (no Markdown, no code fences).',
    'Use semantic tags: h1/h2/h3, p, ul/ol/li, blockquote, strong, em.',
    'Do not include <html>, <head>, or <body> wrappers.',
  ].join('\n')
}

export const buildGenerateHtmlUserPrompt = (instruction: string) => {
  return `Write HTML for the following request:\n\n${instruction}`
}

/**
 * System prompt for plain text
 * (text)
 */
export const buildGenerateTextSystemPrompt = () => {
  return [
    'You are writing plain text.',
    'Return ONLY plain text (no HTML, no Markdown, no code fences, no surrounding quotes).',
    'If the user provides constraints (for example: a maximum character length), you MUST follow them.',
    'If a maximum character length is specified, ensure the output is at most that many characters.',
  ].join('\n')
}

export const buildGenerateTextUserPrompt = (instruction: string) => {
  return `Write plain text for the following request:\n\n${instruction}`
}
